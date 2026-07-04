import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState, FlatList, Linking, Modal, Platform, Pressable, ScrollView, StatusBar as RNStatusBar,
  StyleSheet, Text, TextInput, useColorScheme, View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  applyDecay, Article, dedupeSort, emptyWeights, learn, scoreArticle, Weights,
} from "./core";
import { CATS, COUNTRIES, DEFAULT_PREFS, NEWSLANGS, type Cat, type Prefs } from "./data";
import { fetchMany } from "./feed";
import { makeT } from "./i18n";
import { cancelDigest, ensurePermission, presentNow, scheduleDailyDigest } from "./notify";
import { jget, jset, prefixGetAll } from "./storage";
import { DARK, LIGHT, type Colors } from "./theme";

type SavedRow = { a: Article; savedAt: number; reason: "growth" | "manual" | "read" };
type Tab = "home" | "growth" | "saved" | "settings";

const flagOf = (code: string) => COUNTRIES.find((c) => c.code === code)?.flag || code;

export default function App() {
  const sys = useColorScheme();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const weightsRef = useRef<Weights>(emptyWeights());
  const [tab, setTab] = useState<Tab>("home");
  const [cat, setCat] = useState<string>("ALL");
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const hiddenRef = useRef<Set<string>>(new Set());
  const [detail, setDetail] = useState<Article | null>(null);
  const [digest, setDigest] = useState<Article[] | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [obStep, setObStep] = useState(0);

  const dark = prefs?.theme === "dark" || (prefs?.theme !== "light" && sys === "dark");
  const C = dark ? DARK : LIGHT;
  const t = useMemo(() => makeT(prefs?.uiLang || "ja"), [prefs?.uiLang]);
  const st = useMemo(() => makeStyles(C), [C]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }, []);

  const savePrefs = useCallback((p: Prefs) => {
    setPrefs(p);
    void jset("prefs", p);
  }, []);

  const persistWeights = useCallback(() => {
    void jset("weights", weightsRef.current);
  }, []);

  /* ---------- initial load ---------- */
  useEffect(() => {
    (async () => {
      const p = (await jget<Prefs>("prefs")) || { ...DEFAULT_PREFS };
      const w = await jget<Weights>("weights");
      if (w) weightsRef.current = applyDecay(w);
      const saved = await prefixGetAll<SavedRow>("saved:");
      const sIds = new Set<string>();
      const rIds = new Set<string>();
      for (const { value } of saved) {
        if (value?.a) {
          rIds.add(value.a.id);
          if (value.reason === "manual" || value.reason === "growth") sIds.add(value.a.id);
        }
      }
      setSavedIds(sIds);
      setReadIds(rIds);
      setPrefs(p);
    })();
  }, []);

  /* ---------- digest check (on open / foreground) ---------- */
  const runDigestCheck = useCallback(async (p: Prefs) => {
    if (!p.digestOn) return;
    const now = new Date();
    const [hh, mm] = p.digestTime.split(":").map((n) => parseInt(n, 10));
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const due = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
    if (!due || p.lastDigestDate === today) return;
    savePrefs({ ...p, lastDigestDate: today });
    const { items } = await fetchMany(p.countries, p.digestCats, p.newsLang, false);
    const top = dedupeSort(items, weightsRef.current, hiddenRef.current).slice(0, 8);
    if (top.length) {
      setDigest(top);
      void presentNow("☀️ " + t("digest_title_n"), top.slice(0, 3).map((a) => "・" + a.title.slice(0, 40)).join("\n"));
    }
  }, [savePrefs, t]);

  useEffect(() => {
    if (!prefs?.onboarded) return;
    void runDigestCheck(prefs);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && prefs) void runDigestCheck(prefs);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.onboarded, prefs?.digestOn, prefs?.digestTime]);

  /* ---------- feed loading ---------- */
  const load = useCallback(async (which: Tab, catSel: string, p: Prefs, force: boolean) => {
    setLoading(true);
    let items: Article[] = [];
    let anyCache = false;
    if (which === "home") {
      const cats: Cat[] = catSel === "ALL" ? p.cats.filter((c) => c !== "GROWTH").slice(0, 4) : [catSel as Cat];
      const r = await fetchMany(p.countries, cats, p.newsLang, force);
      items = r.items; anyCache = r.anyCache;
    } else if (which === "growth") {
      const r = await fetchMany(p.countries, ["GROWTH", "TECHNOLOGY", "BUSINESS"], p.newsLang, force);
      items = r.items; anyCache = r.anyCache;
    }
    const sorted = dedupeSort(items, weightsRef.current, hiddenRef.current).slice(0, 60);
    if (which === "growth") {
      const ns = new Set(savedIds);
      sorted.slice(0, 10).forEach((a) => {
        ns.add(a.id);
        void jset("saved:" + a.id, { a, savedAt: Date.now(), reason: "growth" } as SavedRow);
      });
      setSavedIds(ns);
    }
    setArticles(sorted);
    setFromCache(anyCache);
    setLoading(false);
  }, [savedIds]);

  useEffect(() => {
    if (!prefs?.onboarded) return;
    if (tab === "home" || tab === "growth") void load(tab, cat, prefs, false);
    if (tab === "saved") void loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, cat, prefs?.onboarded, prefs?.countries?.join(","), prefs?.newsLang]);

  const [savedRows, setSavedRows] = useState<SavedRow[]>([]);
  const loadSaved = useCallback(async () => {
    const rows = await prefixGetAll<SavedRow>("saved:");
    const list = rows.map((r) => r.value).filter((r) => r?.a);
    list.sort((x, y) => y.savedAt - x.savedAt);
    setSavedRows(list);
  }, []);

  /* ---------- interactions ---------- */
  const openDetail = useCallback((a: Article) => {
    setDetail(a);
    setReadIds((prev) => new Set(prev).add(a.id));
    learn(weightsRef.current, a, 1);
    persistWeights();
    const reason: SavedRow["reason"] = savedIds.has(a.id) ? "manual" : "read";
    void jset("saved:" + a.id, { a, savedAt: Date.now(), reason } as SavedRow);
  }, [persistWeights, savedIds]);

  const hideArticle = useCallback((a: Article) => {
    hiddenRef.current.add(a.id);
    learn(weightsRef.current, a, -1);
    persistWeights();
    setArticles((prev) => prev.filter((x) => x.id !== a.id));
    showToast(t("less_done"));
  }, [persistWeights, showToast, t]);

  const toggleSave = useCallback((a: Article) => {
    const ns = new Set(savedIds);
    if (ns.has(a.id)) {
      ns.delete(a.id);
      void jset("saved:" + a.id, { a, savedAt: Date.now(), reason: "read" } as SavedRow);
    } else {
      ns.add(a.id);
      learn(weightsRef.current, a, 0.5);
      persistWeights();
      void jset("saved:" + a.id, { a, savedAt: Date.now(), reason: "manual" } as SavedRow);
      showToast(t("saved_done"));
    }
    setSavedIds(ns);
  }, [persistWeights, savedIds, showToast, t]);

  const applyDigestSchedule = useCallback(async (p: Prefs) => {
    if (!p.digestOn) { await cancelDigest(); return; }
    const ok = await ensurePermission();
    if (!ok) { showToast(t("perm_needed")); return; }
    const [hh, mm] = p.digestTime.split(":").map((n) => parseInt(n, 10));
    if (Number.isFinite(hh) && Number.isFinite(mm)) {
      await scheduleDailyDigest(hh, mm, "☀️ " + t("digest_title_n"), t("digest_body_n"));
    }
  }, [showToast, t]);

  /* ---------- render helpers ---------- */
  const relTime = useCallback((ts: number) => {
    const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (m < 60) return m + t("min_ago");
    const h = Math.round(m / 60);
    if (h < 24) return h + t("hr_ago");
    return Math.round(h / 24) + t("day_ago");
  }, [t]);

  const Card = useCallback(({ a, noHide }: { a: Article; noHide?: boolean }) => {
    const hot = scoreArticle(weightsRef.current, a) > 3.5 && (weightsRef.current.cats[a.cat] || 0) > 0.5;
    const read = readIds.has(a.id);
    return (
      <Pressable style={st.card} onPress={() => openDetail(a)}>
        <View style={st.cardMeta}>
          <Text style={st.metaText} numberOfLines={1}>
            {a.source ? a.source + " · " : ""}{relTime(a.date)}
          </Text>
          <Text style={st.metaTag}>{flagOf(a.country)} {t("cat_" + a.cat)}</Text>
        </View>
        <Text style={[st.cardTitle, read && { color: C.sub, fontWeight: "500" }]}>{a.title}</Text>
        {!!a.desc && a.desc !== a.title && (
          <Text style={st.cardDesc} numberOfLines={2}>{a.desc}</Text>
        )}
        <View style={st.badgeRow}>
          {hot && <Text style={st.badgeHot}>★ {t("for_you")}</Text>}
          {savedIds.has(a.id) && <Text style={st.badgeSaved}>📥 {t("tab_saved")}</Text>}
        </View>
        {!noHide && (
          <Pressable style={st.hideBtn} hitSlop={8} onPress={() => hideArticle(a)}>
            <Text style={{ color: C.sub, fontSize: 13 }}>✕</Text>
          </Pressable>
        )}
      </Pressable>
    );
  }, [C.sub, hideArticle, openDetail, readIds, relTime, savedIds, st, t]);

  /* ---------- onboarding ---------- */
  if (prefs && !prefs.onboarded) {
    const next = () => setObStep((s) => s + 1);
    const chip = (label: string, on: boolean, onPress: () => void, key?: string) => (
      <Pressable key={key || label} style={[st.opt, on && st.optOn]} onPress={onPress}>
        <Text style={[st.optText, on && { color: C.accent }]}>{label}</Text>
      </Pressable>
    );
    return (
      <View style={[st.root, { paddingTop: topPad() }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 60 }}>
          <View style={st.stepRow}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[st.stepBar, i <= obStep && { backgroundColor: C.accent }]} />
            ))}
          </View>
          {obStep === 0 && (
            <>
              <Text style={st.obTitle}>{t("ob1_t")}</Text>
              <Text style={st.obLead}>{t("ob1_p")}</Text>
              <View style={st.optWrap}>
                {COUNTRIES.map((c) =>
                  chip(
                    `${c.flag} ${prefs.uiLang === "ja" ? c.ja : c.en}`,
                    prefs.countries.includes(c.code),
                    () => {
                      const cur = prefs.countries;
                      const nextArr = cur.includes(c.code) ? cur.filter((x) => x !== c.code) : [...cur, c.code];
                      if (nextArr.length) savePrefs({ ...prefs, countries: nextArr });
                    },
                    c.code
                  )
                )}
              </View>
            </>
          )}
          {obStep === 1 && (
            <>
              <Text style={st.obTitle}>{t("ob2_t")}</Text>
              <Text style={st.obLead}>{t("ob2_p")}</Text>
              <Text style={st.groupLabel}>{t("news_lang")}</Text>
              <View style={st.optWrap}>
                {NEWSLANGS.slice(0, 8).map((l) =>
                  chip(prefs.uiLang === "ja" ? l.ja : l.en, prefs.newsLang === l.code, () => savePrefs({ ...prefs, newsLang: l.code }), l.code)
                )}
              </View>
              <Text style={st.groupLabel}>{t("ui_lang")}</Text>
              <View style={st.optWrap}>
                {chip("日本語", prefs.uiLang === "ja", () => savePrefs({ ...prefs, uiLang: "ja" }))}
                {chip("English", prefs.uiLang === "en", () => savePrefs({ ...prefs, uiLang: "en" }))}
              </View>
            </>
          )}
          {obStep === 2 && (
            <>
              <Text style={st.obTitle}>{t("ob3_t")}</Text>
              <Text style={st.obLead}>{t("ob3_p")}</Text>
              <View style={st.optWrap}>
                {CATS.map((c) =>
                  chip(t("cat_" + c), prefs.cats.includes(c), () => {
                    const cur = prefs.cats;
                    const nextArr = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
                    if (nextArr.length) savePrefs({ ...prefs, cats: nextArr });
                  }, c)
                )}
              </View>
            </>
          )}
          {obStep === 3 && (
            <>
              <Text style={st.obTitle}>{t("ob4_t")}</Text>
              <Text style={st.obLead}>{t("ob4_p")}</Text>
              <TextInput
                style={st.timeInput}
                value={prefs.digestTime}
                onChangeText={(v) => setPrefs({ ...prefs, digestTime: v })}
                placeholder="07:30"
                placeholderTextColor={C.sub}
                keyboardType="numbers-and-punctuation"
              />
              <View style={st.optWrap}>
                {CATS.filter((c) => c !== "GROWTH").map((c) =>
                  chip(t("cat_" + c), prefs.digestCats.includes(c), () => {
                    const cur = prefs.digestCats;
                    const nextArr = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
                    if (nextArr.length) savePrefs({ ...prefs, digestCats: nextArr });
                  }, c)
                )}
              </View>
              <Text style={st.note}>{t("notif_note")}</Text>
            </>
          )}
          <View style={{ height: 26 }} />
          {obStep < 3 ? (
            <Pressable style={st.bigBtn} onPress={next}>
              <Text style={st.bigBtnText}>{t("ob_next")}</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={st.bigBtn}
                onPress={async () => {
                  const time = /^\d{1,2}:\d{2}$/.test(prefs.digestTime) ? prefs.digestTime : "07:30";
                  const p: Prefs = { ...prefs, digestTime: time, digestOn: true, onboarded: true };
                  savePrefs(p);
                  await applyDigestSchedule(p);
                }}
              >
                <Text style={st.bigBtnText}>{t("ob_enable_notif")}</Text>
              </Pressable>
              <Pressable
                style={[st.bigBtn, { backgroundColor: C.chipbg, marginTop: 10 }]}
                onPress={() => savePrefs({ ...prefs, digestOn: false, onboarded: true })}
              >
                <Text style={[st.bigBtnText, { color: C.text }]}>{t("ob_skip_notif")}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={[st.root, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: C.sub }}>…</Text>
      </View>
    );
  }

  /* ---------- main UI ---------- */
  const chipsCats = ["ALL", ...prefs.cats];

  return (
    <View style={[st.root, { paddingTop: topPad() }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      {/* header */}
      <View style={st.header}>
        <View style={st.logo}><Text style={{ color: "#fff", fontWeight: "800" }}>凪</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={st.h1}>
            {tab === "home" ? t("app_name") : tab === "growth" ? t("growth_title") : tab === "saved" ? t("saved_title") : t("settings")}
          </Text>
          <Text style={st.dateLabel}>
            {new Date().toLocaleDateString(prefs.uiLang === "ja" ? "ja-JP" : "en-US", { month: "long", day: "numeric", weekday: "short" })}
          </Text>
        </View>
        {(tab === "home" || tab === "growth") && (
          <Pressable hitSlop={10} onPress={() => { void load(tab, cat, prefs, true); showToast(t("refresh_done")); }}>
            <Text style={{ fontSize: 20, color: C.text }}>↻</Text>
          </Pressable>
        )}
      </View>

      {/* digest banner */}
      {digest && tab === "home" && (
        <Pressable style={st.banner} onPress={() => setDigestOpen(true)}>
          <Text style={st.bannerTitle}>{t("digest_ready")}</Text>
          {digest.slice(0, 2).map((a) => (
            <Text key={a.id} style={st.bannerLine} numberOfLines={1}>・{a.title}</Text>
          ))}
          <Text style={[st.bannerLine, { fontWeight: "700", marginTop: 4 }]}>{t("digest_open")} →</Text>
        </Pressable>
      )}

      {/* category chips */}
      {tab === "home" && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chipRow}>
            {chipsCats.map((c) => (
              <Pressable key={c} style={[st.chip, cat === c && st.chipOn]} onPress={() => setCat(c)}>
                <Text style={[st.chipText, cat === c && { color: C.onAccent }]}>{c === "ALL" ? t("all") : t("cat_" + c)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* content */}
      {tab === "settings" ? (
        <SettingsView
          prefs={prefs} savePrefs={savePrefs} C={C} st={st} t={t}
          onDigestChange={applyDigestSchedule}
          onResetLearn={() => { weightsRef.current = emptyWeights(); persistWeights(); showToast(t("learn_reset_done")); }}
        />
      ) : tab === "saved" ? (
        <FlatList
          data={savedRows}
          keyExtractor={(r) => r.a.id + r.reason}
          contentContainerStyle={{ padding: 14, paddingBottom: 90 }}
          ListHeaderComponent={<Text style={st.subLead}>{t("growth_sub")}</Text>}
          ListEmptyComponent={<Text style={st.empty}>{t("empty_saved")}</Text>}
          renderItem={({ item }) => (
            <View>
              <Text style={st.savedTag}>
                {item.reason === "growth" ? t("saved_growth") : item.reason === "manual" ? t("saved_manual") : t("saved_read")}
              </Text>
              <Card a={item.a} noHide />
            </View>
          )}
        />
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 90 }}
          refreshing={loading}
          onRefresh={() => void load(tab, cat, prefs, true)}
          ListHeaderComponent={
            tab === "growth" ? <Text style={st.subLead}>{t("growth_sub")}</Text> : fromCache ? <Text style={st.cacheNote}>{t("offline_cache")}</Text> : null
          }
          ListEmptyComponent={loading ? <Text style={st.empty}>…</Text> : <Text style={st.empty}>{t("empty_feed")}</Text>}
          renderItem={({ item }) => <Card a={item} />}
          ListFooterComponent={<Text style={st.footNote}>{t("source_note")}</Text>}
        />
      )}

      {/* tab bar */}
      <View style={st.tabbar}>
        {(["home", "growth", "saved", "settings"] as Tab[]).map((tb) => (
          <Pressable key={tb} style={st.tabBtn} onPress={() => { setTab(tb); if (tb === "saved") void loadSaved(); }}>
            <Text style={{ fontSize: 19 }}>{tb === "home" ? "📰" : tb === "growth" ? "🚀" : tb === "saved" ? "📥" : "⚙️"}</Text>
            <Text style={[st.tabLabel, tab === tb && { color: C.accent }]}>{t("tab_" + tb)}</Text>
          </Pressable>
        ))}
      </View>

      {/* toast */}
      {!!toast && (
        <View style={st.toast}><Text style={{ color: C.bg, fontWeight: "600", fontSize: 13 }}>{toast}</Text></View>
      )}

      {/* detail modal */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <Pressable style={st.modalBg} onPress={() => setDetail(null)} />
        <View style={st.sheet}>
          {detail && (
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
              <View style={st.grip} />
              <Text style={st.metaText}>
                {flagOf(detail.country)} {detail.source} · {relTime(detail.date)} · {t("cat_" + detail.cat)}
              </Text>
              <Text style={st.sheetTitle}>{detail.title}</Text>
              <View style={st.summaryBox}>
                <Text style={{ color: C.text, fontSize: 14.5, lineHeight: 22 }}>
                  {detail.desc && detail.desc.length > detail.title.length + 5 ? detail.desc : t("no_summary")}
                </Text>
              </View>
              {detail.related.filter((r) => r.title.slice(0, 40) !== detail.title.slice(0, 40)).length > 0 && (
                <>
                  <Text style={st.groupLabel}>{t("related")}</Text>
                  {detail.related
                    .filter((r) => r.title.slice(0, 40) !== detail.title.slice(0, 40))
                    .map((r, i) => (
                      <Pressable key={i} style={st.relRow} onPress={() => void Linking.openURL(r.link)}>
                        <Text style={{ color: C.text, fontSize: 13.5 }}>{r.title}</Text>
                      </Pressable>
                    ))}
                </>
              )}
              <Pressable style={[st.bigBtn, { marginTop: 16 }]} onPress={() => void Linking.openURL(detail.link)}>
                <Text style={st.bigBtnText}>{t("read_original")}</Text>
              </Pressable>
              <Pressable style={[st.bigBtn, { backgroundColor: C.chipbg, marginTop: 10 }]} onPress={() => toggleSave(detail)}>
                <Text style={[st.bigBtnText, { color: C.text }]}>
                  {savedIds.has(detail.id) ? t("unsave") : "📥 " + t("save_offline")}
                </Text>
              </Pressable>
              <Pressable
                style={[st.bigBtn, { backgroundColor: C.chipbg, marginTop: 10 }]}
                onPress={() => {
                  learn(weightsRef.current, detail, -1.5);
                  persistWeights();
                  setDetail(null);
                  showToast(t("less_done"));
                }}
              >
                <Text style={[st.bigBtnText, { color: C.text }]}>👎 {t("less_genre")}</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* digest modal */}
      <Modal visible={digestOpen} animationType="slide" transparent onRequestClose={() => setDigestOpen(false)}>
        <Pressable style={st.modalBg} onPress={() => setDigestOpen(false)} />
        <View style={st.sheet}>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={st.grip} />
            <Text style={st.sheetTitle}>☀️ {t("digest_title_n")}</Text>
            {(digest || []).map((a) => (
              <Card key={a.id} a={a} noHide />
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/* ================= settings ================= */
function SettingsView({
  prefs, savePrefs, C, st, t, onDigestChange, onResetLearn,
}: {
  prefs: Prefs;
  savePrefs: (p: Prefs) => void;
  C: Colors;
  st: ReturnType<typeof makeStyles>;
  t: (k: string) => string;
  onDigestChange: (p: Prefs) => Promise<void>;
  onResetLearn: () => void;
}) {
  const [timeText, setTimeText] = useState(prefs.digestTime);
  const chip = (label: string, on: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key || label} style={[st.miniChip, on && { backgroundColor: C.accent }]} onPress={onPress}>
      <Text style={{ color: on ? C.onAccent : C.sub, fontSize: 12.5, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  const toggleArr = <K extends "countries" | "cats" | "digestCats">(k: K, v: string) => {
    const cur = prefs[k] as string[];
    const nextArr = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    if (nextArr.length) savePrefs({ ...prefs, [k]: nextArr });
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 100 }}>
      <Text style={st.groupLabel}>{t("s_countries")}</Text>
      <View style={st.optWrap}>
        {COUNTRIES.map((c) => chip(`${c.flag} ${prefs.uiLang === "ja" ? c.ja : c.en}`, prefs.countries.includes(c.code), () => toggleArr("countries", c.code), c.code))}
      </View>

      <Text style={st.groupLabel}>{t("s_newslang")}</Text>
      <View style={st.optWrap}>
        {NEWSLANGS.map((l) => chip(prefs.uiLang === "ja" ? l.ja : l.en, prefs.newsLang === l.code, () => savePrefs({ ...prefs, newsLang: l.code }), l.code))}
      </View>
      <Text style={st.note}>{t("s_newslang_note")}</Text>

      <Text style={st.groupLabel}>{t("s_uilang")}</Text>
      <View style={st.optWrap}>
        {chip("日本語", prefs.uiLang === "ja", () => savePrefs({ ...prefs, uiLang: "ja" }))}
        {chip("English", prefs.uiLang === "en", () => savePrefs({ ...prefs, uiLang: "en" }))}
      </View>

      <Text style={st.groupLabel}>{t("s_cats")}</Text>
      <View style={st.optWrap}>{CATS.map((c) => chip(t("cat_" + c), prefs.cats.includes(c), () => toggleArr("cats", c), c))}</View>

      <Text style={st.groupLabel}>{t("s_digest")}</Text>
      <View style={st.optWrap}>
        {chip(prefs.digestOn ? "ON" : "OFF", prefs.digestOn, () => {
          const p = { ...prefs, digestOn: !prefs.digestOn };
          savePrefs(p);
          void onDigestChange(p);
        })}
      </View>
      <Text style={st.groupLabel}>{t("s_digest_time")}</Text>
      <TextInput
        style={st.timeInput}
        value={timeText}
        onChangeText={setTimeText}
        onEndEditing={() => {
          if (/^\d{1,2}:\d{2}$/.test(timeText)) {
            const p = { ...prefs, digestTime: timeText };
            savePrefs(p);
            void onDigestChange(p);
          } else {
            setTimeText(prefs.digestTime);
          }
        }}
        placeholder="07:30"
        placeholderTextColor={C.sub}
        keyboardType="numbers-and-punctuation"
      />
      <Text style={st.groupLabel}>{t("s_digest_cats")}</Text>
      <View style={st.optWrap}>
        {CATS.filter((c) => c !== "GROWTH").map((c) => chip(t("cat_" + c), prefs.digestCats.includes(c), () => toggleArr("digestCats", c), c))}
      </View>
      <Text style={st.note}>{t("notif_note")}</Text>

      <Text style={st.groupLabel}>{t("s_theme")}</Text>
      <View style={st.optWrap}>
        {(["auto", "light", "dark"] as const).map((th) => chip(t("theme_" + th), prefs.theme === th, () => savePrefs({ ...prefs, theme: th }), th))}
      </View>

      <Text style={st.groupLabel}>{t("s_learn_reset")}</Text>
      <Text style={st.note}>{t("s_learn_note")}</Text>
      <Pressable style={[st.bigBtn, { backgroundColor: C.chipbg }]} onPress={onResetLearn}>
        <Text style={[st.bigBtnText, { color: C.danger }]}>{t("s_learn_reset")}</Text>
      </Pressable>
      <Text style={[st.footNote, { marginTop: 18 }]}>{t("source_note")} · v1.0</Text>
    </ScrollView>
  );
}

/* ================= styles ================= */
const topPad = () => (Platform.OS === "ios" ? 56 : (RNStatusBar.currentHeight || 24) + 6);

function makeStyles(C: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
    logo: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
    h1: { fontSize: 17, fontWeight: "700", color: C.text },
    dateLabel: { fontSize: 11.5, color: C.sub },
    chipRow: { gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: C.chipbg },
    chipOn: { backgroundColor: C.accent },
    chipText: { fontSize: 13.5, fontWeight: "600", color: C.sub },
    banner: { margin: 14, marginBottom: 4, backgroundColor: C.accent, borderRadius: 16, padding: 14 },
    bannerTitle: { color: C.onAccent, fontWeight: "800", fontSize: 15, marginBottom: 4 },
    bannerLine: { color: C.onAccent, fontSize: 13, opacity: 0.95 },
    card: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 10 },
    cardMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" },
    metaText: { fontSize: 11.5, color: C.sub, flexShrink: 1 },
    metaTag: { fontSize: 10.5, color: C.sub, backgroundColor: C.chipbg, borderRadius: 5, paddingHorizontal: 5, overflow: "hidden" },
    cardTitle: { fontSize: 15.5, fontWeight: "700", color: C.text, lineHeight: 22, paddingRight: 24 },
    cardDesc: { fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 18 },
    badgeRow: { flexDirection: "row", gap: 6, marginTop: 8 },
    badgeHot: { fontSize: 10.5, fontWeight: "700", color: "#b45309", backgroundColor: "#fef3c7", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
    badgeSaved: { fontSize: 10.5, fontWeight: "700", color: "#15803d", backgroundColor: "#dcfce7", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
    hideBtn: { position: "absolute", top: 8, right: 8, width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    tabbar: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card, paddingTop: 6, paddingBottom: Platform.OS === "ios" ? 24 : 10 },
    tabBtn: { alignItems: "center", width: 70 },
    tabLabel: { fontSize: 10, fontWeight: "600", color: C.sub, marginTop: 2 },
    toast: { position: "absolute", bottom: 100, alignSelf: "center", backgroundColor: C.text, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999 },
    modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
    sheet: { maxHeight: "85%", backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingTop: 8 },
    grip: { width: 40, height: 4.5, borderRadius: 3, backgroundColor: C.line, alignSelf: "center", marginVertical: 8 },
    sheetTitle: { fontSize: 19, fontWeight: "800", color: C.text, lineHeight: 27, marginVertical: 8 },
    summaryBox: { backgroundColor: C.card, borderRadius: 14, padding: 14, marginVertical: 8 },
    relRow: { backgroundColor: C.card, borderRadius: 12, padding: 12, marginTop: 6, borderWidth: 1, borderColor: C.line },
    bigBtn: { backgroundColor: C.accent, borderRadius: 16, padding: 15, alignItems: "center" },
    bigBtnText: { color: C.onAccent, fontWeight: "800", fontSize: 15 },
    obTitle: { fontSize: 23, fontWeight: "800", color: C.text, marginBottom: 6 },
    obLead: { fontSize: 14, color: C.sub, marginBottom: 16 },
    stepRow: { flexDirection: "row", gap: 6, marginBottom: 24 },
    stepBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.chipbg },
    optWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
    opt: { backgroundColor: C.card, borderWidth: 2, borderColor: C.line, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10 },
    optOn: { borderColor: C.accent },
    optText: { fontSize: 14, fontWeight: "600", color: C.text },
    miniChip: { backgroundColor: C.chipbg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    groupLabel: { fontSize: 12.5, fontWeight: "700", color: C.sub, marginTop: 16, marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.4 },
    note: { fontSize: 12, color: C.sub, lineHeight: 18, marginVertical: 6 },
    timeInput: { backgroundColor: C.card, borderWidth: 2, borderColor: C.line, borderRadius: 14, padding: 13, fontSize: 20, color: C.text, marginBottom: 8 },
    subLead: { fontSize: 12.5, color: C.sub, marginBottom: 10, lineHeight: 18 },
    cacheNote: { fontSize: 12, color: "#b45309", marginBottom: 8, fontWeight: "600" },
    empty: { textAlign: "center", color: C.sub, padding: 40, fontSize: 14 },
    footNote: { textAlign: "center", color: C.sub, fontSize: 11.5, padding: 12 },
    savedTag: { fontSize: 11, color: C.sub, fontWeight: "700", marginBottom: 3 },
  });
}
