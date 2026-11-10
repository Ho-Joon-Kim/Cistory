import type { FileDownloader } from "@protontech/drive-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  downloadOriginal,
  memorySource,
  OriginalTooLargeError,
  seekableSource,
  withOriginalDownloader,
} from "./original-source";

function bytesOf(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => i % 251);
}

/** A downloader over `data`, mimicking the SDK's seek + read(n) contract. */
function fakeDownloader(
  data: Uint8Array,
  opts: {
    claimed?: number | "none";
    seekable?: boolean;
    chunk?: number;
    completion?: () => Promise<void>;
    signatureIssues?: boolean;
  } = {}
) {
  let position = 0;
  const seeks: number[] = [];
  const reads: number[] = [];
  const stream = {
    seek: vi.fn(async (p: number) => {
      seeks.push(p);
      position = p;
    }),
    read: vi.fn(async (n: number) => {
      reads.push(n);
      const value = data.subarray(position, Math.min(data.length, position + n));
      position += value.length;
      return { value, done: position >= data.length };
    }),
  };
  const downloader = {
    getClaimedSizeInBytes: () =>
      opts.claimed === "none" ? undefined : (opts.claimed ?? data.length),
    getSeekableStream: () => {
      if (opts.seekable === false)
        throw new Error("Revision does not have defined claimed block sizes");
      return stream;
    },
    downloadToStream: (sink: WritableStream<Uint8Array>) => {
      const promise = (async () => {
        const writer = sink.getWriter();
        const step = opts.chunk ?? 1000;
        for (let i = 0; i < data.length; i += step) await writer.write(data.subarray(i, i + step));
        await writer.close();
        await opts.completion?.();
      })();
      return {
        pause() {},
        resume() {},
        completion: () => promise,
        isDownloadCompleteWithSignatureIssues: () => opts.signatureIssues ?? false,
      };
    },
    unsafeDownloadToStream: () => {
      throw new Error("never used");
    },
  } as unknown as FileDownloader;
  return { downloader, seeks, reads };
}

describe("seekableSource", () => {
  it("is null when the revision cannot seek", () => {
    const { downloader } = fakeDownloader(bytesOf(10), { seekable: false });
    expect(seekableSource(downloader)).toBeNull();
  });

  it("reads ranges in windows and serves backward reads from its cache", async () => {
    const data = bytesOf(2_000_000);
    const { downloader, seeks } = fakeDownloader(data);
    const source = seekableSource(downloader)!;

    expect(await source.read(1000, 10)).toEqual(data.subarray(1000, 1010));
    expect(await source.read(1004, 100)).toEqual(data.subarray(1004, 1104));
    expect(await source.read(1000, 4)).toEqual(data.subarray(1000, 1004));
    expect(seeks).toEqual([1000]); // one SDK read covered all three
    expect(source.bytesRead).toBe(256 * 1024);

    expect(await source.read(1_900_000, 50)).toEqual(data.subarray(1_900_000, 1_900_050));
    expect(seeks).toEqual([1000, 1_900_000]);
  });

  it("stops at end of file", async () => {
    const data = bytesOf(5000);
    const { downloader, seeks } = fakeDownloader(data);
    const source = seekableSource(downloader)!;
    expect((await source.read(4990, 64)).length).toBe(10);
    expect((await source.read(4995, 64)).length).toBe(5); // inside the EOF window: cached
    expect((await source.read(5000, 64)).length).toBe(0);
    expect(seeks).toEqual([4990]);
  });
});

describe("downloadOriginal", () => {
  it("returns the whole file", async () => {
    const data = bytesOf(12_345);
    expect(await downloadOriginal(fakeDownloader(data).downloader)).toEqual(data);
  });

  it("refuses a file whose claimed size is over the cap without downloading", async () => {
    const { downloader } = fakeDownloader(bytesOf(10), { claimed: 2000 });
    const spy = vi.spyOn(downloader, "downloadToStream");
    await expect(downloadOriginal(downloader, 1000)).rejects.toBeInstanceOf(OriginalTooLargeError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("aborts a transfer that outgrows the cap when the claimed size lied or was missing", async () => {
    const { downloader } = fakeDownloader(bytesOf(5000), { claimed: "none", chunk: 400 });
    await expect(downloadOriginal(downloader, 1000)).rejects.toBeInstanceOf(OriginalTooLargeError);
  });

  it("accepts a completion that failed only on the signature", async () => {
    const data = bytesOf(3000);
    const { downloader } = fakeDownloader(data, {
      completion: async () => {
        throw new Error("signature");
      },
      signatureIssues: true,
    });
    expect(await downloadOriginal(downloader)).toEqual(data);
  });

  it("rethrows any other failure", async () => {
    const { downloader } = fakeDownloader(bytesOf(3000), {
      completion: async () => {
        throw new Error("integrity");
      },
    });
    await expect(downloadOriginal(downloader)).rejects.toThrow("integrity");
  });
});

describe("memorySource", () => {
  it("slices without copying beyond the end", async () => {
    const source = memorySource(bytesOf(10));
    expect((await source.read(8, 5)).length).toBe(2);
    expect(source.size).toBe(10);
  });
});

/**
 * Models the SDK's slot accounting: `getFileDownloader` takes one of a few
 * slots, and only a finished full download or a seekable stream's abort
 * (registered when the stream is created) gives it back.
 */
function slotModel(data: Uint8Array, opts: { seekable?: boolean } = {}) {
  const state = { taken: 0, released: 0 };
  const open = async (signal: AbortSignal) => {
    if (signal.aborted) throw new Error("aborted");
    state.taken += 1;
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        state.released += 1;
      }
    };
    const { downloader } = fakeDownloader(data, { seekable: opts.seekable });
    const seekable = downloader.getSeekableStream.bind(downloader);
    const full = downloader.downloadToStream.bind(downloader);
    return Object.assign(downloader, {
      getSeekableStream: () => {
        const stream = seekable();
        signal.addEventListener("abort", finish, { once: true });
        return stream;
      },
      downloadToStream: (sink: WritableStream<Uint8Array>) => {
        const controller = full(sink);
        const done = (async () => {
          try {
            if (signal.aborted) throw new Error("aborted");
            await controller.completion();
          } finally {
            finish();
          }
        })();
        return { ...controller, completion: () => done };
      },
    }) as FileDownloader;
  };
  return { open, state };
}

describe("withOriginalDownloader", () => {
  const data = bytesOf(20_000);

  it("frees the slot after a partial seekable read", async () => {
    const { open, state } = slotModel(data);
    const head = await withOriginalDownloader(open, 1000, async (d) =>
      seekableSource(d)!.read(0, 16)
    );
    expect(head).toEqual(data.subarray(0, 16));
    expect(state).toEqual({ taken: 1, released: 1 });
  });

  it("frees the slot after a full download, and after a refused oversize one", async () => {
    const { open, state } = slotModel(data, { seekable: false });
    expect(await withOriginalDownloader(open, 1000, (d) => downloadOriginal(d))).toEqual(data);
    await expect(
      withOriginalDownloader(open, 1000, (d) => downloadOriginal(d, 10))
    ).rejects.toBeInstanceOf(OriginalTooLargeError);
    expect(state).toEqual({ taken: 2, released: 2 });
  });

  it("frees an unused downloader's slot, seekable or not, even when `use` throws", async () => {
    for (const seekable of [true, false]) {
      const { open, state } = slotModel(data, { seekable });
      await expect(
        withOriginalDownloader(open, 1000, async () => {
          throw new Error("boom");
        })
      ).rejects.toThrow("boom");
      expect(state).toEqual({ taken: 1, released: 1 });
    }
  });

  it("passes a signal that times out", async () => {
    let seen: AbortSignal | null = null;
    const abortedDuringUse = await withOriginalDownloader(
      async (signal) => {
        seen = signal;
        return fakeDownloader(data).downloader;
      },
      5,
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        return seen?.aborted;
      }
    );
    expect(abortedDuringUse).toBe(true);
  });
});
