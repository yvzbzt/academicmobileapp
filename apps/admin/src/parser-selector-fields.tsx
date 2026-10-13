import React, { useState, type ClipboardEvent } from "react";

export const parserSelectorFields = [
  ["itemSelector", "Liste öğesi", "article, .news-item"],
  ["titleSelector", "Başlık", "h2, .title"],
  ["linkSelector", "İçerik bağlantısı", "a"],
  ["dateSelector", "Yayın tarihi", "time, .date"],
  ["eventDateSelector", "Etkinlik tarihi", ".event-date"],
  ["contentSelector", "Özet / gövde", ".summary, .content"]
] as const;
type Key = typeof parserSelectorFields[number][0];
type Config = Partial<Record<Key, string>>;
const normalize = (text: string) => text.trim().toLocaleLowerCase("tr-TR").replace(/[`*]/g, "").replace(/ seçici$/, "");

// Parse first, then apply: malformed blocks never partially overwrite the form.
export function parseSelectorBlock(text: string): Config | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*\n/i, "").replace(/\n```$/, "");
  if (cleaned.length > 8000) throw new Error("Ayar bloğu çok uzun.");
  let values: Record<string, unknown>;
  if (cleaned.startsWith("{")) {
    try { values = JSON.parse(cleaned); } catch { throw new Error("JSON biçimi geçersiz. Ayar bloğunu eksiksiz kopyalayın."); }
    if (!values || Array.isArray(values)) throw new Error("Ayarlar JSON nesnesi olmalı.");
  } else {
    values = {};
    for (const line of cleaned.split(/\r?\n/)) {
      const parts = line.trim().replace(/^\||\|$/g, "").split(/\t|\s*\|\s*|:\s*/);
      const field = parserSelectorFields.find(([key, title]) => [normalize(key), normalize(title)].includes(normalize(parts[0] ?? "")));
      if (!field || parts.length < 2) continue;
      // Split only the label boundary; CSS selectors can themselves contain colons/pipes.
      const boundary = line.match(/\t|\||:/g)?.[0];
      const row = line.trim().replace(/^\||\|$/g, "");
      const value = row.slice(row.indexOf(boundary!) + 1).trim().replace(/^`|`$/g, "");
      values[field[0]] = /^(boş bırak|boş|\(boş\))$/iu.test(value) ? "" : value;
    }
    if (!Object.keys(values).length) return null; // Ordinary CSS paste is unchanged.
  }
  const allowed = new Set(parserSelectorFields.map(([key]) => key));
  if (!Object.keys(values).length) throw new Error("Ayar bloğu boş.");
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key as Key)) throw new Error(`Bilinmeyen seçici alanı: ${key}`);
    if (typeof value !== "string" || value.length > 300) throw new Error(`${key} en fazla 300 karakterlik metin olmalı.`);
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, (value as string).trim()])) as Config;
}

export function ParserSelectorFields(props: { config?: Config; label?: string }) {
  const [feedback, setFeedback] = useState<{ error?: boolean; text: string }>();
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    try {
      const config = parseSelectorBlock(event.clipboardData.getData("text/plain"));
      if (!config) { setFeedback(undefined); return; }
      event.preventDefault();
      const form = event.currentTarget.form;
      const targets = Object.entries(config).map(([key, value]) => ({ input: form?.elements.namedItem(key), value }));
      if (targets.some(({ input }) => !(input instanceof HTMLInputElement))) throw new Error("Seçici alanları bulunamadı.");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      targets.forEach(({ input, value }) => {
        setter.call(input, value);
        (input as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));
      });
      setFeedback({ text: `${targets.length} seçici alanına yerleştirildi. Kaydetmeden önce kontrol edin.` });
    } catch (error) {
      event.preventDefault();
      setFeedback({ error: true, text: error instanceof Error ? error.message : String(error) });
    }
  }
  return <>
    <p className="inlineHint" style={{ gridColumn: "1 / -1" }}>JSON ayar bloğunu veya alan–değer tablosunu Liste öğesi alanına yapıştırın; seçiciler otomatik yerleşir.</p>
    {parserSelectorFields.map(([name, title, placeholder]) => <label className="fieldLabel" key={name}>{title}{props.label ? "" : " seçici"}
      <input name={name} maxLength={300} placeholder={placeholder} defaultValue={props.config?.[name] ?? ""}
        aria-label={props.label ? `${props.label} ${title.toLocaleLowerCase("tr-TR")} seçici` : undefined}
        onPaste={name === "itemSelector" ? paste : undefined} />
    </label>)}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "academicSourceProblem" : "inlineHint"} style={{ gridColumn: "1 / -1" }}>{feedback.text}</p>}
  </>;
}
