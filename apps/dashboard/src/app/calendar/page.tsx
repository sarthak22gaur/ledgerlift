import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import { parseFilters } from "@/lib/filters";
import {
  getCalendarYearSeries,
  getCalendarMonthSeries,
  getCalendarYearHeatmap,
  getCalendarDayHeatmap,
  getDayOfWeekSeries,
  getSeasonSeries,
  getMonthOfYearSeries,
  getFilterOptions,
  getTransactions,
} from "@/server/data/repository";
import CalendarClient from "./calendar-client";
import DrilldownChart from "@/components/calendar/drilldown-chart";
import DrilldownBreadcrumb from "@/components/calendar/drilldown-breadcrumb";
import CalendarHeatmap from "@/components/calendar/calendar-heatmap";
import YearHeatmap from "@/components/calendar/year-heatmap";
import DayTransactions from "./day-transactions";
import DayOfWeekPanel from "@/components/calendar/day-of-week-panel";
import SeasonPanel from "@/components/calendar/season-panel";

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <h2 className="text-lg font-semibold">No data available</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Run{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
          ledgerlift e2e --force
        </code>{" "}
        to process statements and rebuild the database.
      </p>
    </div>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") sp.set(key, value);
    else if (Array.isArray(value)) value.forEach((v) => sp.append(key, v));
  }
  const filters = parseFilters(sp);

  const metric: "expenses" | "net" =
    params.metric === "net" ? "net" : "expenses";

  const rawYear = typeof params.year === "string" ? params.year : undefined;
  const year =
    rawYear && /^\d{4}$/.test(rawYear) ? rawYear : undefined;

  const rawMonth = typeof params.month === "string" ? params.month : undefined;
  const month =
    rawMonth && /^(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : undefined;

  const rawDay = typeof params.day === "string" ? params.day : undefined;
  const day =
    rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : undefined;

  const showShare = await canShare();

  let datasets: {
    yearSeries: Awaited<ReturnType<typeof getCalendarYearSeries>>;
    monthSeries: Awaited<ReturnType<typeof getCalendarMonthSeries>> | null;
    yearHeatmap: Awaited<ReturnType<typeof getCalendarYearHeatmap>> | null;
    dayHeatmap: Awaited<ReturnType<typeof getCalendarDayHeatmap>> | null;
    dayTransactions: Awaited<ReturnType<typeof getTransactions>> | null;
    dowSeries: Awaited<ReturnType<typeof getDayOfWeekSeries>>;
    seasonSeries: Awaited<ReturnType<typeof getSeasonSeries>>;
    moySeries: Awaited<ReturnType<typeof getMonthOfYearSeries>>;
    filterOptions: Awaited<ReturnType<typeof getFilterOptions>>;
  };

  try {
    const [yearSeries, dowSeries, seasonSeries, moySeries, filterOptions] =
      await Promise.all([
        getCalendarYearSeries(filters, metric),
        getDayOfWeekSeries(filters, metric),
        getSeasonSeries(filters, metric),
        getMonthOfYearSeries(filters, metric),
        getFilterOptions(),
      ]);

    const monthSeries =
      year != null
        ? await getCalendarMonthSeries(filters, metric, year)
        : null;

    const yearHeatmap =
      year != null && month == null
        ? await getCalendarYearHeatmap(filters, metric, year)
        : null;

    const dayHeatmap =
      year != null && month != null
        ? await getCalendarDayHeatmap(filters, metric, year, month)
        : null;

    const dayTransactions =
      day != null
        ? await getTransactions(
            { ...filters, startDate: day, endDate: day },
            1,
            100,
            "transaction_date",
            "asc"
          )
        : null;

    datasets = {
      yearSeries,
      monthSeries,
      yearHeatmap,
      dayHeatmap,
      dayTransactions,
      dowSeries,
      seasonSeries,
      moySeries,
      filterOptions,
    };
  } catch (err) {
    console.error("[calendar/page] failed to load:", err);
    return (
      <AppShell canShare={showShare} pageTitle="Calendar">
        <EmptyState />
      </AppShell>
    );
  }

  const hasData = datasets.yearSeries.length > 0;

  return (
    <AppShell canShare={showShare} pageTitle="Calendar">
      <div className="space-y-6">
        <CalendarClient
          institutions={datasets.filterOptions.institutions}
          categories={datasets.filterOptions.categories}
          metric={metric}
        />

        {!hasData ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {year == null ? (
              <DrilldownChart
                mode="year"
                data={datasets.yearSeries}
                metric={metric}
              />
            ) : month == null ? (
              <div className="space-y-6">
                <DrilldownBreadcrumb year={year} />
                <YearHeatmap
                  data={datasets.yearHeatmap ?? []}
                  year={year}
                  metric={metric}
                />
                {day != null && datasets.dayTransactions != null && (
                  <DayTransactions
                    day={day}
                    transactions={datasets.dayTransactions.data}
                    total={datasets.dayTransactions.total}
                  />
                )}
                <DrilldownChart
                  mode="month"
                  data={datasets.monthSeries ?? []}
                  metric={metric}
                  year={year}
                />
              </div>
            ) : (
              <div className="space-y-6">
                <DrilldownBreadcrumb year={year} month={month} />
                <CalendarHeatmap
                  data={datasets.dayHeatmap ?? []}
                  year={year}
                  month={month}
                  metric={metric}
                />
                {day != null && datasets.dayTransactions != null && (
                  <DayTransactions
                    day={day}
                    transactions={datasets.dayTransactions.data}
                    total={datasets.dayTransactions.total}
                  />
                )}
              </div>
            )}

            <DayOfWeekPanel data={datasets.dowSeries} metric={metric} />
            <SeasonPanel
              seasonData={datasets.seasonSeries}
              moyData={datasets.moySeries}
              metric={metric}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
