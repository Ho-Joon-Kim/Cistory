"use client";

import { Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            저장된 장소
          </CardTitle>
          <CardDescription>자주 방문하는 장소를 저장하여 자동으로 인식합니다</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div role="status" className="flex items-center justify-center py-4">
              <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="sr-only">저장된 장소를 불러오는 중…</span>
            </div>
          ) : places.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">
                저장된 장소가 없습니다. 새 장소 추가로 집이나 회사를 등록하세요.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {places.map((place) => (
                <div
                  key={place.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" title={place.name}>
                      {place.name}
                    </p>
                    {place.address && (
                      <p className="text-xs text-muted-foreground truncate" title={place.address}>
                        {place.address}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        반경 {place.radiusM}m
                      </Badge>
                      {place.category && (
                        <Badge variant="outline" className="text-xs">
                          {place.category}
                        </Badge>
                      )}
                      {place.excludeFromTrips && (
                        <Badge variant="outline" className="text-xs">
                          여행 제외 {Math.round((place.tripExclusionRadiusM ?? 10_000) / 1_000)}km
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Switch
                        id={`trip-exclusion-${place.id}`}
                        size="sm"
                        checked={place.excludeFromTrips}
                        disabled={isSaving}
                        onCheckedChange={(checked) =>
                          void handleTripExclusionChange(place, checked)
                        }
                      />
                      <label
                        htmlFor={`trip-exclusion-${place.id}`}
                        className="cursor-pointer text-xs text-muted-foreground"
                      >
                        여행 감지에서 제외
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${place.name} 편집`}
                      className="h-8 w-8"
                      onClick={() => handleEdit(place)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${place.name} 삭제`}
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(place)}
                      disabled={isSaving}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />새 장소 추가
          </Button>
        </CardContent>
      </Card>

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
