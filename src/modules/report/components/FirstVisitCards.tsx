"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, MapPin } from "lucide-react";

interface FirstVisitCardsProps {
  cities?: { city: string; countryName: string; firstVisitDate: string }[];
  countries?: { countryName: string; firstVisitDate: string }[];
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

export function FirstVisitCards({ cities, countries }: FirstVisitCardsProps) {
  const hasCities = cities && cities.length > 0;
  const hasCountries = countries && countries.length > 0;

  if (!hasCities && !hasCountries) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        처음 방문한 곳
      </h3>

      {hasCountries && (
        <div className="flex flex-wrap gap-2">
          {countries.map((c) => (
            <span
              key={c.countryName}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            >
              <MapPin className="h-3 w-3" />
              {c.countryName}
              <span className="text-xs opacity-70">({formatDate(c.firstVisitDate)})</span>
            </span>
          ))}
        </div>
      )}

      {hasCities && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cities.map((c) => (
            <Card key={`${c.city}-${c.countryName}`} className="!py-3 !gap-1">
              <CardContent className="!pt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{c.city}</p>
                    <p className="text-xs text-muted-foreground">{c.countryName}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(c.firstVisitDate)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
