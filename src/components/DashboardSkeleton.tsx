import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder for a dashboard while its data loads: the sidebar, header and a few cards, in the same shell as the real page. */
export default function DashboardSkeleton({ variant }: { variant: "student" | "admin" }) {
  const student = variant === "student";
  return (
    <div className={`flex ${student ? "min-h-dvh" : "min-h-screen"} bg-background`} aria-busy aria-label="Loading">
      <aside className={`hidden lg:flex w-64 shrink-0 flex-col border-r ${student ? "bg-sidebar border-sidebar-border" : "bg-card"}`}>
        <div className={`flex items-center gap-3 border-b ${student ? "px-5 py-5 border-sidebar-border" : "p-4"}`}>
          <Skeleton className={student ? "h-9 w-9 rounded-xl" : "h-8 w-8 rounded-full"} />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="flex-1 space-y-2 p-3">
          {Array.from({ length: student ? 6 : 9 }, (_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
        </div>
        <div className="flex items-center gap-3 border-t p-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex items-center justify-between gap-3 border-b bg-card/80 ${student ? "h-16 px-3 sm:px-5" : "h-14 px-4"}`}>
          <Skeleton className="h-5 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </header>
        <main className={`flex-1 space-y-6 ${student ? "p-3 sm:p-5 md:p-7" : "p-4 md:p-6"}`}>
          {student && <Skeleton className="h-28 w-full rounded-2xl" />}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Skeleton className="h-72 rounded-xl lg:col-span-2" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </main>
      </div>
    </div>
  );
}
