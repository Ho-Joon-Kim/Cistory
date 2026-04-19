"use client";

import { Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    const success = await deletePlace(place.id);
    if (success) {
      toast.success(`"${place.name}" 장소가 삭제되었습니다`);
    } else {
      toast.error("장소 삭제에 실패했습니다");
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
        toast.success("장소가 수정되었습니다");
        return true;
      }
      toast.error("장소 수정에 실패했습니다");
      return false;
    }
    const success = await createPlace(data);
    if (success) {
      toast.success("장소가 저장되었습니다");
      return true;
    }
    toast.error("장소 저장에 실패했습니다");
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
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : places.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">저장된 장소가 없습니다</p>
            </div>
          ) : (
            <div className="space-y-2">
              {places.map((place) => (
                <div
                  key={place.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{place.name}</p>
                    {place.address && (
                      <p className="text-xs text-muted-foreground truncate">{place.address}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        반경 {place.radiusM}m
                      </Badge>
                      {place.category && (
                        <Badge variant="outline" className="text-xs">
                          {place.category}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleEdit(place)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
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
