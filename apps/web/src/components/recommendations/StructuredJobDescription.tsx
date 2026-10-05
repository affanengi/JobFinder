import React, { useMemo } from "react";
import {
  Target,
  Zap,
  CheckCircle2,
  Building2,
  Gift,
  Globe,
  ShieldCheck,
  Sparkles
} from "lucide-react";

export interface JobDescriptionBlock {
  type: "heading" | "paragraph" | "bullet_list" | "ordered_list";
  text?: string;
  level?: number;
  items?: string[];
}

interface StructuredJobDescriptionProps {
  description?: string;
  blocks?: JobDescriptionBlock[];
  jobTitle?: string;
}

interface RenderSection {
  title: string;
  level: number;
  blocks: JobDescriptionBlock[];
}

function SectionIcon({ title }: { title: string }) {
  const lower = title.toLowerCase();
  if (lower.includes("mission") || lower.includes("objective")) {
    return <Target className="w-4 h-4 text-emerald-400 shrink-0" />;
  }
  if (
    lower.includes("impact") ||
    lower.includes("responsib") ||
    lower.includes("what you will do") ||
    lower.includes("what you'll do") ||
    lower.includes("what you'll be responsible for") ||
    lower.includes("core work") ||
    lower.includes("what your day will look like") ||
    lower.includes("day in the life")
  ) {
    return <Zap className="w-4 h-4 text-amber-400 shrink-0" />;
  }
  if (
    lower.includes("look for") ||
    lower.includes("bring") ||
    lower.includes("qualific") ||
    lower.includes("require") ||
    lower.includes("fit if you") ||
    lower.includes("what you will need") ||
    lower.includes("skills")
  ) {
    return <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />;
  }
  if (lower.includes("about") || lower.includes("who we are") || lower.includes("what is") || lower.includes("team")) {
    return <Building2 className="w-4 h-4 text-indigo-400 shrink-0" />;
  }
  if (lower.includes("benefit") || lower.includes("perk") || lower.includes("offer") || lower.includes("compensation")) {
    return <Gift className="w-4 h-4 text-rose-400 shrink-0" />;
  }
  if (lower.includes("diversity") || lower.includes("inclusion") || lower.includes("equal opportunity")) {
    return <Globe className="w-4 h-4 text-teal-400 shrink-0" />;
  }
  if (lower.includes("compliance") || lower.includes("legal") || lower.includes("privacy")) {
    return <ShieldCheck className="w-4 h-4 text-neutral-400 shrink-0" />;
  }
  return <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />;
}

function renderBulletText(bullet: string) {
  let text = bullet;
  let badge: string | null = null;

  // Extract [Preferred] or [Required]
  const tagMatch = text.match(/^\s*\[(Preferred|Required)\]\s*/i);
  if (tagMatch) {
    badge = tagMatch[1];
    text = text.substring(tagMatch[0].length).trim();
  }

  // Check if bullet starts with a bold lead-in ending with a colon
  const colonMatch = text.match(/^([a-zA-Z0-9&/' -]{3,45}:)\s*(.*)$/);
  if (colonMatch) {
    return (
      <>
        {badge && (
          <span className="inline-block px-1.5 py-0.2 mr-1.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            {badge}
          </span>
        )}
        <span className="font-semibold text-white">{colonMatch[1]} </span>
        <span className="text-neutral-300">{colonMatch[2]}</span>
      </>
    );
  }

  return (
    <>
      {badge && (
        <span className="inline-block px-1.5 py-0.2 mr-1.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          {badge}
        </span>
      )}
      <span className="text-neutral-300">{text}</span>
    </>
  );
}

export const StructuredJobDescription: React.FC<StructuredJobDescriptionProps> = ({
  description,
  blocks,
  jobTitle,
}) => {
  const { requisitionId, sections } = useMemo(() => {
    // 1. Primary path: Use explicit authoritative descriptionBlocks if present
    if (blocks && blocks.length > 0) {
      let requisitionId: string | null = null;
      const parsedSections: RenderSection[] = [];
      let currentSection: RenderSection = {
        title: "Role Overview",
        level: 3,
        blocks: [],
      };

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];

        // Check first block for requisition ID if paragraph
        if (i === 0 && block.type === "paragraph" && block.text) {
          const reqMatch = block.text.match(/^([A-Z0-9]{6,15})\b/);
          if (reqMatch) {
            requisitionId = reqMatch[1];
            const remaining = block.text.substring(reqMatch[0].length).trim();
            if (remaining) {
              currentSection.blocks.push({ ...block, text: remaining });
            }
            continue;
          }
        }

        if (block.type === "heading" && block.text && block.text.trim()) {
          // If previous section has content, save it
          if (currentSection.blocks.length > 0) {
            parsedSections.push(currentSection);
          }
          currentSection = {
            title: block.text.trim(),
            level: block.level || 3,
            blocks: [],
          };
        } else {
          currentSection.blocks.push(block);
        }
      }

      if (currentSection.blocks.length > 0) {
        parsedSections.push(currentSection);
      }

      return { requisitionId, sections: parsedSections };
    }

    // 2. Fallback path for legacy text without explicit blocks
    if (!description || !description.trim()) {
      return { requisitionId: null, sections: [] };
    }

    let raw = description.trim();
    let requisitionId: string | null = null;

    // Check for leading requisition code (e.g., CSQ326R35, REQ-1234)
    const reqMatch = raw.match(/^([A-Z0-9]{6,15})\b/);
    if (reqMatch) {
      requisitionId = reqMatch[1];
      raw = raw.substring(reqMatch[0].length).trim();
    }

    // Remove leading job title duplication if present
    if (jobTitle && raw.toLowerCase().startsWith(jobTitle.toLowerCase())) {
      raw = raw.substring(jobTitle.length).trim();
    }

    // Check if description has markdown headings (### )
    if (raw.includes("### ")) {
      const parts = raw.split(/(?=\n*###\s+)/).filter(Boolean);
      const parsedSections: RenderSection[] = [];

      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith("### ")) {
          const firstLineEnd = trimmed.indexOf("\n");
          const headingTitle = (firstLineEnd !== -1 ? trimmed.substring(4, firstLineEnd) : trimmed.substring(4)).trim();
          const body = (firstLineEnd !== -1 ? trimmed.substring(firstLineEnd) : "").trim();

          const subBlocks: JobDescriptionBlock[] = [];
          if (body) {
            const paragraphs = body.split(/\n\n+/).filter(Boolean);
            for (const p of paragraphs) {
              const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
              if (lines.length > 0 && lines.every((l) => l.startsWith("•") || l.startsWith("-") || l.startsWith("*"))) {
                subBlocks.push({
                  type: "bullet_list",
                  items: lines.map((l) => l.replace(/^[•\-\*]\s*/, "").trim()),
                });
              } else {
                subBlocks.push({
                  type: "paragraph",
                  text: lines.join(" "),
                });
              }
            }
          }

          parsedSections.push({
            title: headingTitle,
            level: 3,
            blocks: subBlocks,
          });
        } else {
          // Preamble without ###
          const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
          parsedSections.push({
            title: "Role Overview",
            level: 3,
            blocks: [
              {
                type: "paragraph",
                text: lines.join(" "),
              },
            ],
          });
        }
      }

      return { requisitionId, sections: parsedSections };
    }

    // Unstructured legacy text: honest paragraph splitting without fake heuristics
    const paras = raw.split(/\n\n+/).filter(Boolean);
    const fallbackBlocks: JobDescriptionBlock[] = paras.map((p) => {
      const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0 && lines.every((l) => l.startsWith("•") || l.startsWith("-") || l.startsWith("*"))) {
        return {
          type: "bullet_list",
          items: lines.map((l) => l.replace(/^[•\-\*]\s*/, "").trim()),
        };
      }
      return {
        type: "paragraph",
        text: lines.join(" "),
      };
    });

    return {
      requisitionId,
      sections: [
        {
          title: "Role Overview",
          level: 3,
          blocks: fallbackBlocks.length > 0 ? fallbackBlocks : [{ type: "paragraph" as const, text: raw }],
        },
      ],
    };
  }, [description, blocks, jobTitle]);

  if ((!blocks || blocks.length === 0) && (!description || description.trim() === "")) {
    return (
      <div className="text-xs text-neutral-500 italic py-4 text-center">
        No full job description was provided for this posting. Refer to the original company portal.
      </div>
    );
  }

  return (
    <div className="space-y-6 text-neutral-300">
      {/* Requisition ID Pill */}
      {requisitionId && (
        <div className="flex items-center gap-2 pb-3 border-b border-white/10 text-xs font-mono">
          <span className="text-neutral-400">Requisition ID:</span>
          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-emerald-400 font-semibold">
            {requisitionId}
          </span>
        </div>
      )}

      {/* Render Structured Sections */}
      {sections.map((section, idx) => (
        <div
          key={idx}
          className="space-y-3 pb-5 border-b border-white/10 last:border-b-0 last:pb-0"
        >
          {/* Section Header with Icon */}
          <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-wide uppercase text-neutral-200">
            <SectionIcon title={section.title} />
            <span>{section.title}</span>
          </div>

          {/* Section Sequential Blocks in Exact Order */}
          <div className="space-y-3 pl-1">
            {section.blocks.map((block: JobDescriptionBlock, bIdx: number) => {
              if (block.type === "paragraph" && block.text) {
                return (
                  <p key={bIdx} className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
                    {block.text}
                  </p>
                );
              }

              if (block.type === "bullet_list" && block.items && block.items.length > 0) {
                const listItems: string[] = block.items;
                return (
                  <ul key={bIdx} className="space-y-2.5">
                    {listItems.map((bullet: string, liIdx: number) => (
                      <li
                        key={liIdx}
                        className="flex items-start gap-2.5 text-xs sm:text-sm text-neutral-300 leading-relaxed"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-2" />
                        <div className="flex-1 min-w-0">{renderBulletText(bullet)}</div>
                      </li>
                    ))}
                  </ul>
                );
              }

              if (block.type === "ordered_list" && block.items && block.items.length > 0) {
                const orderedItems: string[] = block.items;
                return (
                  <ol key={bIdx} className="space-y-2.5 list-decimal list-inside pl-1 text-xs sm:text-sm text-neutral-300 leading-relaxed">
                    {orderedItems.map((item: string, liIdx: number) => (
                      <li key={liIdx} className="leading-relaxed">
                        <span className="text-neutral-300">{item}</span>
                      </li>
                    ))}
                  </ol>
                );
              }

              return null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
