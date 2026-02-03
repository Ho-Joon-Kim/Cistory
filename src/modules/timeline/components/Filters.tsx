"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, X, ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface Repository {
  fullName: string;
  id: number | null;
  isPrivate: boolean | null;
  commitCount: number;
  lastCommitAt: string;
}

interface FiltersProps {
  repositories: Repository[];
  selectedRepoFullNames: string[];
  onRepoFullNamesChange: (fullNames: string[]) => void;
  dateFrom?: string;
  dateTo?: string;
  onDateRangeChange: (from?: string, to?: string) => void;
  onClearFilters: () => void;
}

export function Filters({
  repositories,
  selectedRepoFullNames,
  onRepoFullNamesChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
  onClearFilters,
}: FiltersProps) {
  const [localFrom, setLocalFrom] = useState(dateFrom ?? "");
  const [localTo, setLocalTo] = useState(dateTo ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setLocalFrom(dateFrom ?? "");
    setLocalTo(dateTo ?? "");
  }, [dateFrom, dateTo]);

  const handleDateApply = () => {
    onDateRangeChange(localFrom || undefined, localTo || undefined);
  };

  const handleRepoToggle = (repoFullName: string) => {
    if (selectedRepoFullNames.includes(repoFullName)) {
      onRepoFullNamesChange(selectedRepoFullNames.filter((r) => r !== repoFullName));
    } else {
      onRepoFullNamesChange([...selectedRepoFullNames, repoFullName]);
    }
  };

  const handleSelectAll = () => {
    if (selectedRepoFullNames.length === repositories.length) {
      onRepoFullNamesChange([]);
    } else {
      onRepoFullNamesChange(repositories.map((r) => r.fullName));
    }
  };

  const [isOpen, setIsOpen] = useState(false);
  const hasActiveFilters = selectedRepoFullNames.length > 0 || dateFrom || dateTo;

  const getRepoButtonText = () => {
    if (selectedRepoFullNames.length === 0) {
      return "모든 레포지토리";
    }
    if (selectedRepoFullNames.length === 1) {
      return selectedRepoFullNames[0];
    }
    return `${selectedRepoFullNames.length}개 레포지토리`;
  };

  return (
    <div className="mb-4">
      {/* Toggle button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className={cn("h-8 text-muted-foreground", hasActiveFilters && "text-primary")}
      >
        <SlidersHorizontal className="h-4 w-4 mr-1.5" />
        필터
        {hasActiveFilters && (
          <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px]">
            !
          </span>
        )}
      </Button>

      {/* Collapsible filter content */}
      {isOpen && (
        <div className="flex flex-wrap items-center gap-3 mt-2 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          {/* Repository filter */}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 justify-between min-w-[180px] max-w-[280px]",
                  selectedRepoFullNames.length > 0 && "border-primary"
                )}
              >
                <span className="truncate">{getRepoButtonText()}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
              <div className="p-2 border-b">
                <label
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer"
                >
                  <Checkbox
                    checked={selectedRepoFullNames.length === repositories.length && repositories.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                  <span className="text-sm">전체 선택</span>
                </label>
              </div>
              <div className="max-h-[300px] overflow-y-auto p-2">
                {repositories.map((repo) => (
                  <label
                    key={repo.fullName}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedRepoFullNames.includes(repo.fullName)}
                      onCheckedChange={() => handleRepoToggle(repo.fullName)}
                      className="flex-shrink-0"
                    />
                    <span className="truncate flex-1 text-sm">{repo.fullName}</span>
                    <span className="text-xs text-muted-foreground">{repo.commitCount}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Date filter */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              value={localFrom}
              onChange={(e) => setLocalFrom(e.target.value)}
              className="w-[130px] h-8 text-sm"
            />
            <span className="text-muted-foreground">~</span>
            <Input
              type="date"
              value={localTo}
              onChange={(e) => setLocalTo(e.target.value)}
              className="w-[130px] h-8 text-sm"
            />
            <Button variant="outline" size="sm" onClick={handleDateApply} className="h-8">
              적용
            </Button>
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="text-muted-foreground h-8"
            >
              <X className="h-4 w-4 mr-1" />
              초기화
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
