import React, { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Building2, ChevronRight, RefreshCcw, Save, Play } from "lucide-react";
import type { AnnouncementSourceRecord, AnnouncementSourcePreview, SourceCorrectionTarget } from "./main";
import { buildSourceHealthAlerts } from "./source-health-alerts";
import "./academic-source-workbench.css";
import { ParserSelectorFields, parserSelectorFields as selectors } from "./parser-selector-fields";

type Scope = "university" | "faculty" | "department";
type Content = "announcement" | "news" | "event";
type Unit = { id: string; name: string; universityId?: string; facultyId?: string; websiteUrl?: string };
type Selection = Unit & { scope: Scope; universityId: string };
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
interface Props {
  request: Api;
  universities: Unit[];
  sources?: AnnouncementSourceRecord[];
  correctionTarget?: SourceCorrectionTarget;
  onUnitSelected?: (universityId: string) => void;
  onSourcesChanged: (sources: AnnouncementSourceRecord[]) => void;
  renderUniversity: (universityId: string, onDirtyChange: (dirty: boolean) => void) => ReactNode;
  renderPreview: (preview: AnnouncementSourcePreview) => ReactNode;
}
const labels: Record<Content, string> = { announcement: "Duyuru", news: "Haber", event: "Etkinlik" };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

// Read every page; catalog visibility must never depend on the first source page.
export async function readAllAdminSources(request: Api, signal?: AbortSignal): Promise<AnnouncementSourceRecord[]> {
  const sources = new Map<string, AnnouncementSourceRecord>();
  for (let offset = 0; ;) {
    const payload = await request<AnnouncementSourceRecord[] | { items: AnnouncementSourceRecord[]; hasMore?: boolean }>(
      `/admin/announcements/sources?limit=101&offset=${offset}`, { signal }
    );
    const page = Array.isArray(payload) ? payload : payload.items;
    const explicitPaging = !Array.isArray(payload) && payload.hasMore !== undefined;
    const more = explicitPaging ? payload.hasMore : page.length > 100;
    const accepted = explicitPaging || !more ? page : page.slice(0, 100);
    const previousSize = sources.size;
    accepted.forEach((source) => sources.set(source.id, source));
    if (!more) return [...sources.values()];
    if (sources.size === previousSize) throw new Error("Kaynak sayfalaması ilerlemiyor; liste tamamlanamadı.");
    offset += accepted.length;
  }
}

export function AcademicSourceWorkbench(props: Props) {
  const sources = props.sources ?? [];
  const [faculties, setFaculties] = useState<Record<string, Unit[]>>({});
  const [departments, setDepartments] = useState<Record<string, Unit[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingUnits, setLoadingUnits] = useState<Set<string>>(new Set());
  const [unitErrors, setUnitErrors] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<Selection>();
  const [inlineCorrection, setInlineCorrection] = useState<SourceCorrectionTarget>();
  const correctionTarget = inlineCorrection ?? props.correctionTarget;
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const loadRef = useRef(0);
  const appliedCorrection = useRef("");
  const dirtyRef = useRef(false);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef(props.request);
  apiRef.current = props.request;

  async function reload(signal?: AbortSignal, reportFailure = false) {
    const generation = ++loadRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await readAllAdminSources(apiRef.current, signal);
      if (generation === loadRef.current) props.onSourcesChanged(result);
    } catch (cause) {
      if (!signal?.aborted && generation === loadRef.current) setError(errorText(cause));
      if (reportFailure) throw new Error(`İşlem tamamlandı ancak kaynak listesi yenilenemedi: ${errorText(cause)}`);
    } finally {
      if (generation === loadRef.current && !signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => { controller.abort(); loadRef.current += 1; };
  }, []);

  async function openUnit(unit: Selection, select = true) {
    if (select && (selection?.id !== unit.id || selection.scope !== unit.scope || inlineCorrection)) {
      if (dirtyRef.current && !window.confirm("Kaydedilmemiş değişiklikler var. Kaydetmeden ayrılmak istiyor musunuz?")) return;
      dirtyRef.current = false;
      setInlineCorrection(undefined);
      setCorrectionError("");
      setSelection(unit);
      props.onUnitSelected?.(unit.universityId);
    }
    if (unit.scope === "department") return;
    const key = `${unit.scope}:${unit.id}`;
    setExpanded((current) => new Set(current).add(key));
    const cache = unit.scope === "university" ? faculties : departments;
    if (cache[unit.id] || loadingUnits.has(key)) return;
    setLoadingUnits((current) => new Set(current).add(key));
    setUnitErrors((current) => ({ ...current, [key]: "" }));
    try {
      const path = unit.scope === "university"
        ? `/universities/${encodeURIComponent(unit.id)}/faculties`
        : `/faculties/${encodeURIComponent(unit.id)}/departments`;
      const children = await apiRef.current<Unit[]>(path);
      if (unit.scope === "university") setFaculties((current) => ({ ...current, [unit.id]: children }));
      else setDepartments((current) => ({ ...current, [unit.id]: children }));
    } catch (cause) {
      setUnitErrors((current) => ({ ...current, [key]: errorText(cause) }));
    } finally {
      setLoadingUnits((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }

  useEffect(() => {
    const target = correctionTarget;
    if (!target) { appliedCorrection.current = ""; return; }
    if (loading) return;
    const targetKey = `${target.universityId}:${target.sourceId}:${target.scopeId ?? ""}:${target.contentType}`;
    if (appliedCorrection.current === targetKey) return;
    const source = sources.find((candidate) => candidate.id === target.sourceId);
    const university = props.universities.find((candidate) => candidate.id === target.universityId);
    if (!university) return;
    const controller = new AbortController();
    appliedCorrection.current = "";
    setSelection(undefined);
    dirtyRef.current = false;
    setCorrectionError("");
    void (async () => {
      if (!source && !target.scopeId) throw new Error("Düzeltilecek kaynak bulunamadı. Uyarı listesini yenileyin.");
      const owner = source ?? { scopeType: target.scopeType, scopeId: target.scopeId, ownerFacultyId: target.facultyId };
      if (source?.ownerUniversityId && source.ownerUniversityId !== university.id) throw new Error("Kaynak seçilen üniversiteye ait değil.");
      if (owner.scopeType === "university" && owner.scopeId !== university.id) throw new Error("Kaynak seçilen üniversiteye ait değil.");
      const catalogFaculties = await apiRef.current<Unit[]>(`/universities/${encodeURIComponent(university.id)}/faculties`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setFaculties((current) => ({ ...current, [university.id]: catalogFaculties }));
      const nextExpanded = new Set([`university:${university.id}`]);
      let selected: Selection = { ...university, scope: "university", universityId: university.id };
      if (owner.scopeType === "faculty") {
        const faculty = catalogFaculties.find((unit) => unit.id === owner.scopeId);
        if (!faculty) throw new Error("Kaynağın fakültesi katalogda bulunamadı.");
        selected = { ...faculty, scope: "faculty", universityId: university.id };
      } else if (owner.scopeType === "department") {
        // Legacy sources may omit ownerFacultyId; resolve the real parent from catalog data.
        let found = false;
        for (const faculty of catalogFaculties.filter((unit) => !owner.ownerFacultyId || unit.id === owner.ownerFacultyId)) {
          const children = await apiRef.current<Unit[]>(`/faculties/${encodeURIComponent(faculty.id)}/departments`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setDepartments((current) => ({ ...current, [faculty.id]: children }));
          const department = children.find((unit) => unit.id === owner.scopeId);
          if (!department) continue;
          selected = { ...department, scope: "department", universityId: university.id, facultyId: faculty.id };
          nextExpanded.add(`faculty:${faculty.id}`);
          found = true;
          break;
        }
        if (!found) throw new Error("Kaynağın bölümü katalogda bulunamadı.");
      }
      if (controller.signal.aborted) return;
      appliedCorrection.current = targetKey;
      dirtyRef.current = false;
      setExpanded(nextExpanded);
      setSelection(selected);
    })().catch((cause) => { if (!controller.signal.aborted) setCorrectionError(errorText(cause)); });
    return () => controller.abort();
  }, [correctionTarget?.universityId, correctionTarget?.sourceId, correctionTarget?.scopeId, correctionTarget?.contentType, props.universities.length, loading]);

  useEffect(() => {
    if (!correctionTarget) return;
    const pane = treeScrollRef.current;
    const row = pane?.querySelector<HTMLElement>(".academicTreeRow.selected");
    if (!pane || !row) return;
    const bounds = pane.getBoundingClientRect();
    const selected = row.getBoundingClientRect();
    if (selected.top < bounds.top) pane.scrollTop += selected.top - bounds.top;
    else if (selected.bottom > bounds.bottom) pane.scrollTop += selected.bottom - bounds.bottom;
  }, [selection?.id, selection?.scope, correctionTarget?.sourceId]);

  const health = buildSourceHealthAlerts(sources);
  const unhealthyIds = new Set(health.map((alert) => alert.sourceId));
  function unitSources(unit: Selection) {
    return sources.filter((source) => source.scopeType === unit.scope && source.scopeId === unit.id);
  }
  function renderUnit(unit: Selection, depth: number): ReactNode {
    const key = `${unit.scope}:${unit.id}`;
    const isExpanded = expanded.has(key);
    const children = unit.scope === "university" ? faculties[unit.id] : departments[unit.id];
    const ownSources = unitSources(unit);
    const problems = ownSources.filter((source) => unhealthyIds.has(source.id)).length;
    const descendantProblems = sources.filter((source) => unhealthyIds.has(source.id) && (
      unit.scope === "university" ? source.ownerUniversityId === unit.id && source.scopeType !== "university"
        : unit.scope === "faculty" && source.scopeType === "department" && (source.ownerFacultyId === unit.id
          || departments[unit.id]?.some((child) => child.id === source.scopeId))
    )).length;
    return <div className="academicTreeBranch" data-unit-key={key} key={key}>
      <div className={`academicTreeRow ${selection?.id === unit.id && selection.scope === unit.scope ? "selected" : ""}`} style={{ paddingLeft: 8 + depth * 16 }}>
        {unit.scope !== "department" ? <button type="button" className="academicTreeToggle" aria-label={`${unit.name} ${isExpanded ? "daralt" : "genişlet"}`} aria-expanded={isExpanded}
          onClick={() => isExpanded
            ? setExpanded((current) => { const next = new Set(current); next.delete(key); return next; })
            : void openUnit(unit, false)}><ChevronRight size={15} className={isExpanded ? "expanded" : ""} /></button> : <span className="academicTreeLeaf" />}
        <button type="button" className="academicTreeSelect" aria-pressed={selection?.id === unit.id && selection.scope === unit.scope} onClick={() => void openUnit(unit)}>
          <span>{unit.name}</span>
          <small>{problems ? `${problems} sorun` : ownSources.length ? `${ownSources.length} kaynak` : "Kaynak ekle"}
            {descendantProblems > 0 && ` · ${descendantProblems} alt birim sorunu`}</small>
        </button>
      </div>
      {isExpanded && unit.scope !== "department" && <div>
        {loadingUnits.has(key) && <p className="inlineHint">Birimler yükleniyor…</p>}
        {unitErrors[key] && <div role="alert"><p>{unitErrors[key]}</p><button type="button" className="btn btn-secondary" onClick={() => void openUnit(unit)}>Tekrar dene</button></div>}
        {children?.length === 0 && <p className="inlineHint">Katalogda {unit.scope === "university" ? "fakülte" : "bölüm"} kaydı yok.</p>}
        {children?.map((child) => renderUnit({ ...child, scope: unit.scope === "university" ? "faculty" : "department", universityId: unit.universityId,
          ...(unit.scope === "faculty" ? { facultyId: unit.id } : {}) }, depth + 1))}
      </div>}
    </div>;
  }
  const visibleUniversities = props.universities.filter((unit) => unit.name.toLocaleLowerCase("tr-TR").includes(search.trim().toLocaleLowerCase("tr-TR")));
  const problemUniversity = inlineCorrection?.universityId ?? selection?.universityId;
  const unitProblems = health.filter((alert) => alert.universityId === problemUniversity && sources.some((source) => source.id === alert.sourceId && source.scopeType !== "university"));
  return <section className="panel wide academicSourceWorkbench" aria-label="Akademik kaynak çalışma alanı">
    <div className="panelHeader"><div><h2><Building2 size={20} /> Akademik Kaynaklar</h2><p className="panelSub">Üniversite, fakülte veya bölüm seçin; kaynaklarını aynı alanda düzenleyin.</p></div>
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => {
        if (!dirtyRef.current || window.confirm("Kaydedilmemiş değişiklikler var. Listeyi yine de yenilemek istiyor musunuz?")) void reload();
      }}><RefreshCcw size={16} /> Kaynakları yenile</button></div>
    {error && <p role="alert">{error}</p>}
    {correctionError && <p role="alert" className="academicSourceProblem">{correctionError}</p>}
    <div className="academicWorkbenchLayout">
      <aside className={`academicTreePane ${!props.correctionTarget && problemUniversity ? "hasProblemUnits" : ""}`} aria-label="Üniversite fakülte bölüm ağacı">
        <label className="fieldLabel">Üniversite ara<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Üniversite adı" /></label>
        <p className="academicTreeCount">{props.universities.length} üniversite · {loading ? "Kaynaklar yükleniyor…" : `${sources.length} kaynak`}</p>
        {!props.correctionTarget && problemUniversity && <section className="academicProblemUnits" aria-label="Sorunlu fakülte ve bölümler">
          <h3>Sorunlu fakülte ve bölümler <span>{unitProblems.length}</span></h3>
          <p className="inlineHint">Bir kaynağa tıkla; düzeltme formu sağda açılır.</p>
          {loading ? <p className="inlineHint">Kaynaklar yükleniyor…</p> : !unitProblems.length ? <p className="inlineHint">Bu üniversitede alt birim uyarısı yok.</p>
            : <div className="academicProblemList">{unitProblems.map((alert) => {
              const source = sources.find((candidate) => candidate.id === alert.sourceId)!;
              const faculty = faculties[problemUniversity]?.find((unit) => unit.id === (source.scopeType === "faculty" ? source.scopeId : source.ownerFacultyId));
              const universityName = props.universities.find((unit) => unit.id === problemUniversity)?.name ?? "";
              const title = source.scopeType === "faculty" && faculty ? faculty.name : source.sourceName.replace(universityName, "").trim();
              return <button type="button" key={source.id} className="academicProblemButton" aria-pressed={inlineCorrection?.sourceId === source.id} onClick={() => {
                if (inlineCorrection?.sourceId === source.id || (dirtyRef.current && !window.confirm("Kaydedilmemiş değişiklikler var. Kaydetmeden ayrılmak istiyor musunuz?"))) return;
                dirtyRef.current = false;
                setInlineCorrection({ universityId: problemUniversity, sourceId: source.id, contentType: (source.contentType ?? "announcement") as Content });
              }}>
                {source.scopeType === "department" && faculty && <small>{faculty.name}</small>}
                <strong>{title}</strong><span>{labels[(source.contentType ?? "announcement") as Content]} · {source.scopeType === "faculty" ? "Fakülte" : "Bölüm"}</span>
                <small>{alert.problem}</small>
              </button>;
            })}</div>}
        </section>}
        <div className="academicTreeScroll" ref={treeScrollRef}>{visibleUniversities.map((unit) => renderUnit({ ...unit, scope: "university", universityId: unit.id }, 0))}</div>
        {!visibleUniversities.length && <p className="inlineHint">Eşleşen üniversite bulunamadı.</p>}
      </aside>
      <div className="academicEditorPane">
        {!selection ? <div className="academicEditorEmpty"><Building2 size={32} /><strong>Bir akademik birim seçin</strong><p>Soldaki oklarla fakülteleri ve bölümleri açabilirsiniz.</p></div>
          : <><header className="academicSelectionHeader"><small>{props.universities.find((unit) => unit.id === selection.universityId)?.name} / {selection.scope === "department" ? `${faculties[selection.universityId]?.find((unit) => unit.id === selection.facultyId)?.name ?? "Fakülte"} / Bölüm` : selection.scope === "faculty" ? "Fakülte" : "Üniversite geneli"}</small><h3>{selection.name}</h3></header>
            {(selection.scope === "university" ? props.renderUniversity(selection.id, (dirty) => { dirtyRef.current = dirty; }) : null)
              ?? <ScopedSourceEditor key={`${selection.scope}:${selection.id}:${correctionTarget?.sourceId ?? ""}`} unit={selection} sources={unitSources(selection)} request={apiRef.current}
                  loading={loading} targetSourceId={correctionTarget?.sourceId || undefined} initialContent={correctionTarget?.contentType} renderPreview={props.renderPreview}
                  onDirtyChange={(dirty) => { dirtyRef.current = dirty; }} refresh={() => reload(undefined, true)} />}
          </>}
      </div>
    </div>
  </section>;
}

function ScopedSourceEditor(props: { unit: Selection; sources: AnnouncementSourceRecord[]; request: Api; loading: boolean;
  refresh: () => Promise<void>; onDirtyChange: (dirty: boolean) => void; renderPreview: Props["renderPreview"]; targetSourceId?: string; initialContent?: string }) {
  const [content, setContent] = useState<Content>(() => props.sources.find((source) => source.id === props.targetSourceId)?.contentType
    ?? (props.initialContent === "news" || props.initialContent === "event" ? props.initialContent : "announcement"));
  const [sourceId, setSourceId] = useState(props.targetSourceId ?? "");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<AnnouncementSourcePreview>();
  const candidates = props.sources.filter((source) => (source.contentType ?? "announcement") === content);
  const source = candidates.find((candidate) => candidate.id === sourceId) ?? (sourceId === "new" ? undefined : candidates[0]);
  const label = labels[content];
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  function markDirty(value: boolean) {
    setDirty(value); props.onDirtyChange(value);
    if (value) { setPreview(undefined); setMessage(""); }
  }
  function canLeave() {
    return !dirty || window.confirm("Kaydedilmemiş değişiklikler var. Kaydetmeden ayrılmak istiyor musunuz?");
  }
  function fence() {
    return source ? {
      expectedSourceDefinitionVersion: source.sourceDefinitionVersion ?? "",
      expectedCanonicalUrl: source.canonicalUrl ?? source.sourceUrl,
      expectedTrustStatus: source.trustStatus === "trusted" || source.trustStatus === "rejected" ? source.trustStatus : "quarantined",
      expectedSourceStatus: source.status,
      expectedApprovalPending: source.approvalPending === true
    } : {};
  }
  async function action(task: () => Promise<void>, testing = false) {
    setBusy(true); setPreviewing(testing); setError(""); setMessage(""); setPreview(undefined);
    try { await task(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); setPreviewing(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const parserConfig = Object.fromEntries(selectors.map(([name]) => [name, values[name].trim()]).filter(([, value]) => value));
    await action(async () => {
      const body = { sourceName: values.sourceName.trim(), sourceUrl: values.sourceUrl.trim(), contentType: content, parser: values.parser,
        parserConfig, priority: Number(values.priority), fetchIntervalMinutes: Number(values.fetchIntervalMinutes) };
      const result = await props.request<AnnouncementSourceRecord | { source: AnnouncementSourceRecord }>(source
        ? `/admin/announcements/sources/${encodeURIComponent(source.id)}` : "/admin/announcements/sources", {
        method: source ? "PUT" : "POST", body: JSON.stringify(source ? { ...body, ...fence(), expectedUpdatedAt: source.updatedAt, status: values.status }
          : { ...body, scopeType: props.unit.scope, universityId: props.unit.universityId,
            ...(props.unit.scope !== "university" ? { facultyId: props.unit.scope === "faculty" ? props.unit.id : props.unit.facultyId } : {}),
            ...(props.unit.scope === "department" ? { departmentId: props.unit.id } : {}) })
      });
      const saved = "source" in result ? result.source : result;
      setSourceId(saved.id); markDirty(false); await props.refresh();
      setMessage(source ? "Kaynak ayarları kaydedildi." : "Kaynak oluşturuldu. Önizleyip onayladıktan sonra içerik çekebilirsiniz.");
    });
  }
  const problems = source ? buildSourceHealthAlerts([source]) : [];
  return <div className="scopedSourceEditor">
    <div className="academicContentTabs" aria-label="Kaynak içerik türü">{(Object.keys(labels) as Content[]).map((type) => <button type="button" className={type === content ? "selected" : ""} key={type} disabled={busy}
      aria-pressed={type === content} onClick={() => { if (type === content || !canLeave()) return; setContent(type); setSourceId(""); setPreview(undefined); setMessage(""); setError(""); markDirty(false); }}>{labels[type]}</button>)}</div>
    {props.loading && <p className="inlineHint">Tüm kaynak kayıtları yükleniyor…</p>}
    <label className="fieldLabel">{label} kaynağı<select value={source?.id ?? "new"} disabled={busy || props.loading} onChange={(event) => { if (!canLeave()) return; setSourceId(event.target.value); setPreview(undefined); markDirty(false); }}>
      {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.sourceName}</option>)}<option value="new">Yeni {label.toLocaleLowerCase("tr-TR")} kaynağı</option></select></label>
    {problems.map((problem) => <p className="academicSourceProblem" role="status" key={problem.sourceId}>Son sağlık kontrolü: {problem.problem}
      {problem.lastProbeAt && <> · {new Date(problem.lastProbeAt).toLocaleString("tr-TR")}</>}</p>)}
    {source && <p className="inlineHint">{source.approvalPending ? "Onay kontrolü bekliyor" : source.trustStatus === "trusted" ? "Onaylı kaynak" : "İnsan onayı gerekiyor"} · {source.status === "active" ? "Aktif" : "Pasif"}</p>}
    <form ref={formRef} key={`${content}:${source?.id ?? "new"}:${source?.updatedAt ?? ""}`} onSubmit={save} onChange={() => markDirty(true)} className="academicSourceForm">
      <fieldset disabled={busy || props.loading}>
        <label className="fieldLabel">Kaynak adı<input name="sourceName" required minLength={2} maxLength={160} defaultValue={source?.sourceName ?? `${props.unit.name} ${label}`} /></label>
        <label className="fieldLabel">Çekilen URL<input name="sourceUrl" type="url" pattern="https://.*" required maxLength={2048} defaultValue={source?.sourceUrl ?? ""} placeholder="https://…" /></label>
        <div className="academicFieldGrid"><label className="fieldLabel">Parser<select name="parser" aria-label="Parser" defaultValue={source?.parser ?? "auto"}><option value="auto">Otomatik</option><option value="rss">RSS / Atom</option><option value="html">HTML</option></select></label>
          <label className="fieldLabel">Çalışma durumu<select name="status" aria-label="Çalışma durumu" disabled={!source} defaultValue={source?.status ?? "inactive"}><option value="inactive">Pasif</option><option value="active">Aktif</option></select></label></div>
        <details className="academicAdvancedSettings"><summary>Gelişmiş parser ayarları</summary>
          <p className="inlineHint">Otomatik çekim yeterli değilse CSS seçicilerini düzenleyin.</p>
          <div className="academicFieldGrid"><ParserSelectorFields key={`${props.unit.id}:${content}:${source?.id ?? "new"}`} config={source?.parserConfig} /></div>
        </details>
        <div className="academicFieldGrid"><label className="fieldLabel">Öncelik<input name="priority" type="number" min={1} max={100} required defaultValue={source?.priority ?? 50} /></label>
          <label className="fieldLabel">Kontrol aralığı (dakika)<input name="fetchIntervalMinutes" type="number" min={5} max={10080} required defaultValue={source?.fetchIntervalMinutes ?? 180} /></label></div>
        <button className="btn btn-primary" type="submit"><Save size={16} /> {busy ? "İşleniyor…" : "Kaydet"}</button>
      </fieldset>
    </form>
    <div className="sourceActions">
      <button className="btn btn-secondary" type="button" disabled={busy || !source || dirty || props.loading} onClick={() => void action(async () => {
        const result = await props.request<AnnouncementSourcePreview>(`/admin/announcements/sources/${encodeURIComponent(source!.id)}/preview`, { method: "POST" }); setPreview(result);
      }, true)} aria-busy={previewing}><Play size={16} /> {previewing ? "Test ediliyor…" : "Test Et / Önizle"}</button>
      <button className="btn btn-secondary" type="button" disabled={busy || !source || dirty || props.loading} onClick={() => void action(async () => {
        await props.request(`/admin/announcements/sources/${encodeURIComponent(source!.id)}/approve`, { method: "POST", body: JSON.stringify(fence()) });
        await props.refresh(); setMessage("Kaynak onay kontrolü tamamlandı.");
      })}>Onayla ve Devreye Al</button>
      <button className="btn btn-secondary" type="button" disabled={busy || !source || dirty || source.trustStatus !== "trusted" || source.status !== "active" || source.approvalPending || props.loading}
        onClick={() => void action(async () => {
          const result = await props.request<{ status: string; itemCount: number; error?: string }>(`/admin/announcements/sources/${encodeURIComponent(source!.id)}/ingest`, { method: "POST" });
          await props.refresh(); if (result.error) throw new Error(result.error); setMessage(`${result.itemCount} içerik · ${result.status}`);
        })}>İçerikleri Çek</button>
    </div>
    {previewing && <p role="status" className="inlineHint">Kaynak test ediliyor… Üniversitenin sayfasından yanıt bekleniyor.</p>}
    {dirty && <p className="inlineHint">Önizlemeden önce değişiklikleri kaydedin.</p>}
    {error && <p role="alert" className="academicSourceProblem">{error}</p>}
    {message && <p role="status">{message}</p>}
    {preview && props.renderPreview(preview)}
  </div>;
}
