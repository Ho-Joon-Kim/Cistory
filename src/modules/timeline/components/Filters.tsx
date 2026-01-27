"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Filter, X } from "lucide-react";

interface Repository {
  fullName: string;
  id: number | null;
  isPrivate: boolean | null;
  commitCount: number;
  lastCommitAt: string;
}

interface FiltersProps {
  repositories: Repository[];
  selectedRepoFullName?: string;
  onRepoFullNameChange: (fullName?: string) => void;
  dateFrom?: string;
  dateTo?: string;
  onDateRangeChange: (from?: string, to?: string) => void;
  onClearFilters: () => void;
}

export function Filters({
  repositories,
  selectedRepoFullName,
  onRepoFullNameChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
  onClearFilters,
}: FiltersProps) {
  const [localFrom, setLocalFrom] = useState(dateFrom ?? "");
  const [localTo, setLocalTo] = useState(dateTo ?? "");

  useEffect(() => {
    setLocalFrom(dateFrom ?? "");
    setLocalTo(dateTo ?? "");
  }, [dateFrom, dateTo]);

  const handleDateApply = () => {
    onDateRangeChange(localFrom || undefined, localTo || undefined);
  };

  const hasActiveFilters = selectedRepoFullName || dateFrom || dateTo;

  return (
    <div className="space-y-4">
      {/* First row: Repository filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Repository filter */}
        <Select
          value={selectedRepoFullName ?? "all"}
          onValueChange={(value) => {
            onRepoFullNameChange(value === "all" ? undefined : value);
          }}
        >
          <SelectTrigger className="w-full sm:w-[280px]">
            <SelectValue placeholder="모든 레포지토리" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">모든 레포지토리</SelectItem>
            {repositories.map((repo) => (
              <SelectItem key={repo.fullName} value={repo.fullName}>
                {repo.fullName} ({repo.commitCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-muted-foreground w-fit"
          >
            <X className="h-4 w-4 mr-1" />
            필터 초기화
          </Button>
        )}
      </div>

      {/* Second row: Date filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm text-muted-foreground">기간:</span>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
          <Input
            type="date"
            value={localFrom}
            onChange={(e) => setLocalFrom(e.target.value)}
            className="w-full sm:w-[140px]"
            placeholder="시작일"
          />
          <span className="text-muted-foreground hidden sm:inline">~</span>
          <Input
            type="date"
            value={localTo}
            onChange={(e) => setLocalTo(e.target.value)}
            className="w-full sm:w-[140px]"
            placeholder="종료일"
          />
          <Button variant="outline" size="sm" onClick={handleDateApply} className="w-full sm:w-auto">
            적용
          </Button>
        </div>
      </div>

      {/* Active filters display */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" />
          <span>
            필터 적용 중:
            {selectedRepoFullName && (
              <span className="ml-1">{selectedRepoFullName}</span>
            )}
            {dateFrom && <span className="ml-1">{dateFrom} 이후</span>}
            {dateTo && <span className="ml-1">{dateTo} 이전</span>}
          </span>
        </div>
      )}
    </div>
  );
}
