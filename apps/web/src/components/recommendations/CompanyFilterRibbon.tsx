import React, { useState, useRef, useEffect, useCallback } from "react";
import { Building2, ChevronLeft, ChevronRight } from "lucide-react";

export interface CompanyMetric {
  key: string;
  canonicalName: string;
  domain: string;
  count: number;
}

export const CANONICAL_COMPANY_MAP: Record<string, { name: string; domain: string }> = {
  "databricks": { name: "Databricks", domain: "databricks.com" },
  "openai": { name: "OpenAI", domain: "openai.com" },
  "stripe": { name: "Stripe", domain: "stripe.com" },
  "figma": { name: "Figma", domain: "figma.com" },
  "mongodb": { name: "MongoDB", domain: "mongodb.com" },
  "canonical": { name: "Canonical", domain: "canonical.com" },
  "gitlab": { name: "GitLab", domain: "gitlab.com" },
  "scale ai": { name: "Scale AI", domain: "scale.com" },
  "scaleai": { name: "Scale AI", domain: "scale.com" },
  "scaleai labs": { name: "Scale AI", domain: "scale.com" },
  "notion": { name: "Notion", domain: "notion.so" },
  "linear": { name: "Linear", domain: "linear.app" },
  "sentry": { name: "Sentry", domain: "sentry.io" },
  "supabase": { name: "Supabase", domain: "supabase.com" },
  "ramp": { name: "Ramp", domain: "ramp.com" },
  "cloudflare": { name: "Cloudflare", domain: "cloudflare.com" },
  "elastic": { name: "Elastic", domain: "elastic.co" },
  "thoughtworks": { name: "Thoughtworks", domain: "thoughtworks.com" },
  "palantir": { name: "Palantir", domain: "palantir.com" },
  "meesho": { name: "Meesho", domain: "meesho.io" },
  "cred": { name: "CRED", domain: "cred.club" },
  "spotify": { name: "Spotify", domain: "spotify.com" },
};

export function getCanonicalCompanyInfo(rawName: string): { key: string; canonicalName: string; domain: string } {
  const trimmed = rawName.trim();
  const lowerKey = trimmed.toLowerCase();
  
  if (CANONICAL_COMPANY_MAP[lowerKey]) {
    const mapped = CANONICAL_COMPANY_MAP[lowerKey];
    return {
      key: lowerKey,
      canonicalName: mapped.name,
      domain: mapped.domain,
    };
  }

  // Fallback normalization
  const cleanDomain = lowerKey.replace(/[^a-z0-9]/g, "") + ".com";
  // Capitalize words
  const titleName = trimmed.replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    key: lowerKey,
    canonicalName: titleName,
    domain: cleanDomain,
  };
}

export function CompanyLogo({
  company,
  domain,
  size = 18,
}: {
  company: string;
  domain?: string;
  size?: number;
}) {
  const [hasError, setHasError] = useState(false);

  // Compute 1-2 letter monogram fallback
  const initials = company
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || company.slice(0, 1).toUpperCase();

  if (!hasError && domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
        alt={`${company} logo`}
        onError={() => setHasError(true)}
        className="rounded-full object-contain shrink-0 bg-white/5"
        style={{ width: size, height: size }}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className="rounded-full bg-emerald-500/20 text-emerald-400 font-mono font-bold flex items-center justify-center shrink-0 border border-emerald-500/30"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.floor(size * 0.5)) }}
      title={company}
      aria-label={`${company} logo`}
    >
      {initials}
    </div>
  );
}

interface CompanyFilterRibbonProps {
  companies: CompanyMetric[];
  selectedCompany: string | null;
  onSelectCompany: (companyKey: string | null) => void;
  totalCount: number;
}

export const CompanyFilterRibbon: React.FC<CompanyFilterRibbonProps> = ({
  companies,
  selectedCompany,
  onSelectCompany,
  totalCount,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll, companies]);

  const handleScroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = direction === "left" ? -260 : 260;
      scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
      setTimeout(checkScroll, 320);
    }
  };

  return (
    <div className="w-full pb-1 relative flex items-center group">
      {/* Left Scroll Arrow Button */}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center pr-2 bg-gradient-to-r from-[#0A0A0A] via-[#0A0A0A]/90 to-transparent pointer-events-auto">
          <button
            type="button"
            onClick={() => handleScroll("left")}
            className="p-1.5 rounded-full bg-[#1A1A1A] hover:bg-[#262626] border border-white/20 hover:border-white/40 text-white shadow-lg transition-all cursor-pointer flex items-center justify-center hover:scale-105 active:scale-95"
            aria-label="Scroll companies left"
            title="Scroll left"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Dynamic Company Chips Container */}
      <div 
        ref={scrollContainerRef}
        className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none w-full scroll-smooth"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        role="group"
        aria-label="Filter opportunities by company"
      >
        {/* All Companies Option */}
        <button
          onClick={() => onSelectCompany(null)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer shrink-0 ${
            selectedCompany === null
              ? "bg-white text-black border-white shadow-sm font-semibold"
              : "bg-[#141414] hover:bg-[#1E1E1E] text-neutral-300 border-white/10 hover:border-white/20"
          }`}
          aria-pressed={selectedCompany === null}
        >
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span>All Companies</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              selectedCompany === null
                ? "bg-black/15 text-black font-bold"
                : "bg-white/10 text-neutral-400"
            }`}
          >
            {totalCount}
          </span>
        </button>

        {/* Dynamic Company Chips */}
        {companies.map((comp) => {
          const isSelected = selectedCompany === comp.key;
          return (
            <button
              key={comp.key}
              onClick={() => onSelectCompany(isSelected ? null : comp.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer shrink-0 ${
                isSelected
                  ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 font-semibold shadow-sm ring-1 ring-emerald-500/30"
                  : "bg-[#141414] hover:bg-[#1E1E1E] text-neutral-300 border-white/10 hover:border-white/20"
              }`}
              aria-pressed={isSelected}
              title={`Filter opportunities by ${comp.canonicalName}`}
            >
              <CompanyLogo company={comp.canonicalName} domain={comp.domain} size={16} />
              <span>{comp.canonicalName}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  isSelected
                    ? "bg-emerald-500/30 text-emerald-200 font-bold"
                    : "bg-white/10 text-neutral-400"
                }`}
              >
                {comp.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Right Scroll Arrow Button */}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 z-10 flex items-center pl-2 bg-gradient-to-l from-[#0A0A0A] via-[#0A0A0A]/90 to-transparent pointer-events-auto">
          <button
            type="button"
            onClick={() => handleScroll("right")}
            className="p-1.5 rounded-full bg-[#1A1A1A] hover:bg-[#262626] border border-white/20 hover:border-white/40 text-white shadow-lg transition-all cursor-pointer flex items-center justify-center hover:scale-105 active:scale-95"
            aria-label="Scroll companies right"
            title="View more companies"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
