import { createContext, useContext, useState, type ReactNode } from "react";
import { toIanaTimeZone } from "@shared/timezone";

const TZ_KEY = "noc_clock_tz";

export interface TzOption {
  value: string;
  label: string;
  offset: string;
}

export const TZ_OPTIONS: TzOption[] = [
  { value: "UTC",                 label: "UTC",           offset: "UTC+0"    },
  { value: "America/New_York",    label: "New York",      offset: "EST/EDT"  },
  { value: "America/Chicago",     label: "Chicago",       offset: "CST/CDT"  },
  { value: "America/Denver",      label: "Denver",        offset: "MST/MDT"  },
  { value: "America/Los_Angeles", label: "Los Angeles",   offset: "PST/PDT"  },
  { value: "America/Sao_Paulo",   label: "São Paulo",     offset: "BRT/BRST" },
  { value: "Europe/London",       label: "London",        offset: "GMT/BST"  },
  { value: "Europe/Paris",        label: "Paris",         offset: "CET/CEST" },
  { value: "Europe/Berlin",       label: "Berlin",        offset: "CET/CEST" },
  { value: "Europe/Moscow",       label: "Moscow",        offset: "MSK"      },
  { value: "Africa/Cairo",        label: "Cairo",         offset: "EET"      },
  { value: "Africa/Johannesburg", label: "Johannesburg",  offset: "SAST"     },
  { value: "Asia/Dubai",          label: "Dubai",         offset: "GST"      },
  { value: "Asia/Karachi",        label: "Karachi",       offset: "PKT"      },
  { value: "Asia/Kolkata",        label: "Mumbai/Delhi",  offset: "IST"      },
  { value: "Asia/Dhaka",          label: "Dhaka",         offset: "BST"      },
  { value: "Asia/Bangkok",        label: "Bangkok",       offset: "ICT"      },
  { value: "Asia/Singapore",      label: "Singapore",     offset: "SGT"      },
  { value: "Asia/Hong_Kong",      label: "Hong Kong",     offset: "HKT"      },
  { value: "Asia/Tokyo",          label: "Tokyo",         offset: "JST"      },
  { value: "Australia/Sydney",    label: "Sydney",        offset: "AEDT/AEST"},
  { value: "Pacific/Auckland",    label: "Auckland",      offset: "NZDT/NZST"},
];

export function getTzAbbr(tz: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? tz
    );
  } catch {
    return tz;
  }
}

interface TimezoneContextValue {
  tz: string;
  setTz: (tz: string) => void;
  tzAbbr: string;
}

const TimezoneContext = createContext<TimezoneContextValue>({
  tz: "UTC",
  setTz: () => {},
  tzAbbr: "UTC",
});

export function TimezoneProvider({ children }: { children: ReactNode }) {
  // Resolved on the way in AND on the way out. localStorage can hold a stale
  // or hand-edited value, and consumers pass tz straight to Intl — an
  // unusable identifier there throws RangeError inside a render or an interval
  // callback, which is exactly how a dropdown label took down the Invoices
  // page. Nothing downstream should have to defend itself.
  const [tz, setTzState] = useState<string>(() => {
    try {
      return toIanaTimeZone(localStorage.getItem(TZ_KEY));
    } catch {
      return "UTC";
    }
  });

  const setTz = (newTz: string) => {
    const resolved = toIanaTimeZone(newTz);
    setTzState(resolved);
    try {
      localStorage.setItem(TZ_KEY, resolved);
    } catch {}
  };

  const tzAbbr = getTzAbbr(tz);

  return (
    <TimezoneContext.Provider value={{ tz, setTz, tzAbbr }}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone(): TimezoneContextValue {
  return useContext(TimezoneContext);
}
