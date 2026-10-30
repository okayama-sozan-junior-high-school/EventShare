import * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "~/lib/utils"

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative min-w-0">
      <select
        data-slot="native-select"
        className={cn(
          "h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 opacity-50" aria-hidden />
    </div>
  )
}

export { NativeSelect }
