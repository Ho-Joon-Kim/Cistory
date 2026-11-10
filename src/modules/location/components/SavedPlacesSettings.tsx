"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LoadingState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import {
  PanelActions,
  PanelIconButton,
  PanelList,
  PanelListItem,
  PanelSwitch,
  PanelText,
} from "@/modules/settings/components/panel";
import { type SavedPlaceData, useSavedPlaces } from "../hooks";
import { SavedPlaceDialog } from "./SavedPlaceDialog";

export function SavedPlacesSettings() {
  const { places, isLoading, isSaving, createPlace, updatePlace, deletePlace } = useSavedPlaces();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState<SavedPlaceData | null>(null);

  const handleCreate = () => {
    setEditingPlace(null);
    setDialogOpen(true);
  };

  const handleEdit = (place: SavedPlaceData) => {
    setEditingPlace(place);
    setDialogOpen(true);
  };

  const handleDelete = async (place: SavedPlaceData) => {
    if (
      !window.confirm(
        `"${place.name}" 장소를 삭제할까요? 이 장소로 인식하던 방문 이름과 여행 감지 제외 설정이 사라집니다.`
      )
    )
      return;
    const success = await deletePlace(place.id);
    if (success) {
      toast.success(`"${place.name}" 장소가 삭제되었습니다.`);
    } else {
      toast.error("장소를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleTripExclusionChange = async (place: SavedPlaceData, checked: boolean) => {
    const success = await updatePlace(place.id, {
      excludeFromTrips: checked,
      ...(checked && place.tripExclusionRadiusM === null ? { tripExclusionRadiusM: 10_000 } : {}),
    });
    if (success) {
      toast.success(
        checked ? "여행 감지 제외 장소로 설정되었습니다." : "여행 감지 제외가 해제되었습니다."
      );
    } else {
      toast.error("여행 감지 제외 설정을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleSave = async (data: {
    name: string;
    lat: number;
    lon: number;
    radiusM: number;
    category?: string;
    address?: string;
  }) => {
    if (editingPlace) {
      const success = await updatePlace(editingPlace.id, data);
      if (success) {
        toast.success("장소가 수정되었습니다.");
        return true;
      }
      toast.error("장소를 수정하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    }
    const success = await createPlace(data);
    if (success) {
      toast.success("장소가 저장되었습니다.");
      return true;
    }
    toast.error("장소를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return false;
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <PanelText>
          자주 가는 곳을 저장하면 방문 이름으로 쓰여요. 집처럼 생활권인 곳은 여행 감지에서 뺄 수
          있어요.
        </PanelText>
        {isLoading ? (
          <LoadingState variant="rows" rows={3} label="저장한 장소를 불러오는 중" />
        ) : places.length === 0 ? (
          <PanelText>아직 저장한 장소가 없어요. 장소 추가로 집이나 회사를 등록해 보세요.</PanelText>
        ) : (
          <PanelList label="저장한 장소">
            {places.map((place) => {
              const address = place.displayAddress ?? place.address;
              const meta = [address, `반경 ${formatCount(place.radiusM)}m`, place.category].filter(
                Boolean
              );
              return (
                <PanelListItem key={place.id}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className="text-sm leading-5 font-semibold [overflow-wrap:anywhere]"
                      title={place.name}
                    >
                      {place.name}
                    </span>
                    <span
                      className="text-xs leading-4 text-ink-3 [overflow-wrap:anywhere]"
                      title={address ?? undefined}
                    >
                      {meta.join(" · ")}
                    </span>
                    <span className="mt-1">
                      <PanelSwitch
                        id={`trip-exclusion-${place.id}`}
                        checked={place.excludeFromTrips}
                        disabled={isSaving}
                        onCheckedChange={(checked) =>
                          void handleTripExclusionChange(place, checked)
                        }
                      >
                        여행 감지에서 제외
                        {place.excludeFromTrips ? (
                          <span className="text-ink-3">
                            {`· 반경 ${formatCount(Math.round((place.tripExclusionRadiusM ?? 10_000) / 1_000))}km`}
                          </span>
                        ) : null}
                      </PanelSwitch>
                    </span>
                  </span>
                  <span className="-mr-2 flex flex-none items-center">
                    <PanelIconButton label={`${place.name} 편집`} onClick={() => handleEdit(place)}>
                      <Pencil aria-hidden="true" />
                    </PanelIconButton>
                    <PanelIconButton
                      label={`${place.name} 삭제`}
                      onClick={() => void handleDelete(place)}
                      disabled={isSaving}
                      danger
                    >
                      <Trash2 aria-hidden="true" />
                    </PanelIconButton>
                  </span>
                </PanelListItem>
              );
            })}
          </PanelList>
        )}
        <PanelActions>
          <Button variant="outline" size="sm" onClick={handleCreate}>
            <Plus aria-hidden="true" />
            장소 추가
          </Button>
        </PanelActions>
      </div>

      <SavedPlaceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        place={editingPlace}
        onSave={handleSave}
        isSaving={isSaving}
      />
    </>
  );
}
