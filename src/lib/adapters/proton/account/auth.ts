// Vendored from ProtonDriveApps/sdk incubating/account/js/src @ 05c9115 — MIT, Copyright (c) 2025-2026 Proton AG. Local changes marked "CISTORY:".
import { AccountApi, AccountApiError } from './accountApi';
import {
    DEFAULT_PROTON_ACCOUNT_URL,
    FORK_INITIAL_DELAY_MS,
    FORK_MAX_POLL_TIME_MS,
    FORK_POLL_INTERVAL_MS,
    generateSignInUrl,
    parseUserKeyPassword,
} from './authWeb';
import type { Logger } from './logger';
import type { SessionCredentials } from './sessionCredentials';
import { sleepMs } from './sleep';
import type { Srp } from './srp';
import { fetchTelemetryEnabled } from './telemetryPreference';

// CISTORY: split-fork result types shared with ../fork.ts and ../http.ts.
export type ProtonSessionTokens = { uid: string; accessToken: string; refreshToken: string };
export type ForkPollResult =
    | { status: 'pending' }
    | { status: 'ready'; tokens: ProtonSessionTokens; keyPassword: string };

export class Auth {
    constructor(
        private readonly authClientId: string,
        private readonly accountApi: AccountApi,
        private readonly credentials: SessionCredentials,
        private readonly srpModule: Srp,
        private readonly logger: Logger,
        private readonly accountUrl: string = DEFAULT_PROTON_ACCOUNT_URL,
    ) {}

    isLoggedIn(): boolean {
        return this.credentials.isLoggedIn();
    }

    async loadSession(): Promise<void> {
        await this.credentials.load();
    }

    async logout(): Promise<void> {
        await this.credentials.signOut();
    }

    async authViaPassword(
        username: string,
        password: string,
    ): Promise<{
        uid: string;
        accessToken: string;
        refreshToken?: string;
    }> {
        this.logger.debug('Getting auth info');
        const info = await this.accountApi.info(username);

        if (!info.Version || !info.Modulus || !info.SRPSession || !info.ServerEphemeral || !info.Salt) {
            throw new Error('Missing required auth info fields');
        }

        this.logger.debug('Generating proofs');
        const { clientEphemeral, clientProof, expectedServerProof } = await this.srpModule.getSrp(
            info.Version,
            info.Modulus,
            info.ServerEphemeral,
            info.Salt,
            password,
        );

        this.logger.debug('Authenticating');
        const authResponse = await this.accountApi.auth({
            Username: username,
            SRPSession: info.SRPSession,
            PersistentCookies: 1,
            Payload: {},
            ClientProof: clientProof,
            ClientEphemeral: clientEphemeral,
        });

        if (!authResponse.ServerProof) {
            throw new Error('Missing ServerProof');
        }
        if (authResponse.ServerProof !== expectedServerProof) {
            throw new Error('Server proof verification failed');
        }
        if (!authResponse.UID || !authResponse.AccessToken) {
            throw new Error('Missing UID or AccessToken');
        }

        await this.credentials.setSessionInfo({
            uid: authResponse.UID,
            accessToken: authResponse.AccessToken,
            ...(authResponse.RefreshToken !== undefined && { refreshToken: authResponse.RefreshToken }),
        });

        this.logger.debug(`Getting user key password`);
        const userKeyPassword = await this.getUserKeyPassword(password);

        await this.credentials.setUserKeyPassword(userKeyPassword);

        await this.loadTelemetryPreference();

        return {
            uid: authResponse.UID,
            accessToken: authResponse.AccessToken,
            refreshToken: authResponse.RefreshToken,
        };
    }

    private async getUserKeyPassword(loginPassword: string): Promise<string> {
        const salts = await this.accountApi.salts();
        const userKeySalt = salts.KeySalts?.at(0)?.KeySalt;
        if (!userKeySalt) {
            throw new Error('Missing KeySalt');
        }

        const keyPassword = await this.srpModule.computeKeyPassword(loginPassword, userKeySalt);
        return keyPassword;
    }

    async authViaWeb(
        onSignInUrl: (signInUrl: string) => void | Promise<void>,
        signal?: AbortSignal,
    ): Promise<{
        uid: string;
        accessToken: string;
        refreshToken?: string;
    }> {
        this.logger.debug('Authenticating via web');
        const forkResponse = await this.accountApi.sessionForksInit();

        const { encryptionKey, signInUrl } = generateSignInUrl(
            this.authClientId,
            forkResponse.UserCode,
            this.accountUrl,
        );

        await onSignInUrl(signInUrl);

        await sleepMs(FORK_INITIAL_DELAY_MS, signal);

        const startTime = Date.now();
        while (true) {
            if (Date.now() - startTime > FORK_MAX_POLL_TIME_MS) {
                throw new Error('Authentication timed out');
            }

            this.logger.debug('Checking authentication status');

            let response;
            try {
                response = await this.accountApi.sessionForksStatus(forkResponse.Selector);
            } catch (error) {
                // The API returns 422 if the authentication is not yet ready.
                if (error instanceof AccountApiError && error.httpCode === 422) {
                    const debug = error.debug as { Error?: string };
                    this.logger.debug(`Authentication not yet ready (${error.code}: ${debug.Error})`);
                    await sleepMs(FORK_POLL_INTERVAL_MS, signal);
                    continue;
                }

                throw error;
            }

            const userKeyPassword = parseUserKeyPassword(encryptionKey, response.Payload);

            this.logger.debug('Authentication successful');

            await this.credentials.setUserKeyPassword(userKeyPassword);
            await this.credentials.setSessionInfo({
                uid: response.UID,
                accessToken: response.AccessToken,
                refreshToken: response.RefreshToken,
            });

            await this.loadTelemetryPreference();

            return {
                uid: response.UID,
                accessToken: response.AccessToken,
                refreshToken: response.RefreshToken,
            };
        }
    }

    /**
     * CISTORY: first half of `authViaWeb` — starts the fork and returns the
     * sign-in URL without polling or touching credentials, so a stateless web
     * request can hand the URL to the user and poll later.
     */
    async beginWebFork(): Promise<{ selector: string; signInUrl: string; encryptionKey: Buffer }> {
        const forkResponse = await this.accountApi.sessionForksInit();
        const { encryptionKey, signInUrl } = generateSignInUrl(
            this.authClientId,
            forkResponse.UserCode,
            this.accountUrl,
        );
        return { selector: forkResponse.Selector, signInUrl, encryptionKey };
    }

    /**
     * CISTORY: one iteration of the `authViaWeb` poll loop. Does not write
     * credentials or load the telemetry preference; the caller persists the
     * returned tokens and key password.
     */
    async pollWebForkOnce(selector: string, encryptionKey: Buffer): Promise<ForkPollResult> {
        let response;
        try {
            response = await this.accountApi.sessionForksStatus(selector);
        } catch (error) {
            // The API returns 422 if the authentication is not yet ready.
            if (error instanceof AccountApiError && error.httpCode === 422) {
                return { status: 'pending' };
            }
            throw error;
        }
        if (!response.RefreshToken) {
            throw new Error('Fork response is missing RefreshToken');
        }
        const keyPassword = parseUserKeyPassword(encryptionKey, response.Payload);
        return {
            status: 'ready',
            tokens: {
                uid: response.UID,
                accessToken: response.AccessToken,
                refreshToken: response.RefreshToken,
            },
            keyPassword,
        };
    }

    private async loadTelemetryPreference(): Promise<void> {
        const telemetryEnabled = await fetchTelemetryEnabled(this.accountApi, this.logger);
        this.logger.debug(`User telemetry preference: ${telemetryEnabled}`);
        await this.credentials.setTelemetryEnabled(telemetryEnabled);
    }
}
