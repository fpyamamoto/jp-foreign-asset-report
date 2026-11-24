// Tests for jp-foreign-asset-report.  Run from the repository root:  node tests/run.js
// RULES, the dictionary, the state helpers and the judgement functions are extracted from
// the production index.html and run unchanged. Expected values come from the specification
// (Vault note "Web 国外財産調書 提出義務チェッカー の仕様書", section 3) and the NTA FAQ (August 2026 edition).
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").replace(/\r\n/g, "\n");

let passed = 0, failed = 0;
function check(name, cond, detail){
  if(cond){ passed++; }
  else { failed++; console.log("FAIL: " + name + (detail ? "  (" + detail + ")" : "")); }
}
function eq(name, got, want){ check(name, got === want, "got " + got + ", want " + want); }

/* ---------- extract ---------- */
const a0 = html.indexOf("const RULES = {");
const a1 = html.lastIndexOf("/*", html.indexOf("4. HELPERS"));
const b0 = html.indexOf("/** 提出期限");
const b1 = html.lastIndexOf("/*", html.indexOf("5. RENDER — rows"));
if([a0, a1, b0, b1].some(x => x < 0)){ console.log("FAIL: blocks not found"); process.exit(1); }
const E = vm.runInNewContext(html.slice(a0, a1) + "\n" + html.slice(b0, b1) +
  "\n;({RULES, I18N, judge, deadlineOf, lastBankDay, rowJPY, rowCounts, rowExcludable, rowVerdict, setS: x => { S = x; }})", {});

const RES = {live:"yes", jpn:"yes"};
const row = (cat, ans, amt, o) => Object.assign({cat, ans, ccy:"JPY", amt:String(amt), rate:"", share:"", excl:false, inh:false, label:""}, o || {});
const run = (rows, o) => { E.setS(Object.assign({year:2025, res:RES, exempt:false, inherit:false, rows}, o || {})); return E.judge(); };
const dep = (amt, o) => row("deposit", {branch:"fr"}, amt, o);

/* ---------- spec section 3 ---------- */
eq("1 exactly 50,000,000 -> no", run([dep(50000000)]).code, "no");
eq("2 50,000,001 -> yes", run([dep(50000001)]).code, "yes");
{
  const r = run([dep(333334, {ccy:"USD", rate:"150"})]);
  eq("3 USD 333,334 x 150 -> yes", r.code, "yes"); eq("3 total", r.total, 50000100);
  const r4 = run([dep(333333.34, {ccy:"USD", rate:"150"})]);
  eq("4 USD 333,333.34 x 150 -> 50,000,001", r4.total, 50000001); eq("4 -> yes", r4.code, "yes");
}
eq("5 domestic branch FX deposit -> no", run([row("deposit", {branch:"jp"}, 60000000)]).code, "no");
eq("6 Japanese shares in a foreign account -> yes", run([row("securities", {issuer:"jpco", account:"fracc"}, 60000000)]).code, "yes");
eq("7 foreign shares in a Japanese account -> no", run([row("securities", {issuer:"frco", account:"jpacc"}, 60000000)]).code, "no");
eq("8 crypto only -> no", run([row("crypto", {}, 1000000000)]).code, "no");
eq("9 real estate 1億 (loan not deducted) -> yes", run([row("realestate", {loc:"fr"}, 100000000)]).code, "yes");
{
  const r = run([row("realestate", {loc:"fr"}, 100000000, {share:"50"})]);
  eq("10 co-owned 50% -> 5,000万 -> no", r.code, "no"); eq("10 total", r.total, 50000000);
}
{
  const r = run([dep(50500000), row("other", {sub:"derivative", where:"fr"}, -1000000)]);
  eq("11 unrealised loss netted -> 4,950万 -> no", r.code, "no"); eq("11 total", r.total, 49500000);
}
{
  const r = run([dep(40000000), dep(30000000, {inh:true})], {inherit:true});
  eq("12 inheritance year special rule -> 4,000万 -> no", r.code, "no");
}
eq("13 non-permanent resident -> not required", (E.setS({year:2025, res:{live:"yes", jpn:"no", five:"no"}, exempt:false, inherit:false, rows:[dep(1000000000)]}), E.judge()).code, "nonperm");
eq("14 foreign national over 5 years -> yes", (E.setS({year:2025, res:{live:"yes", jpn:"no", five:"yes"}, exempt:false, inherit:false, rows:[dep(60000000)]}), E.judge()).code, "yes");
{
  const r = run([dep(49950000), row("movables", {place:"fr", kind:"other"}, 800000, {excl:true})]);
  eq("15 other movables under 10万 left out -> no", r.code, "no"); eq("15 total", r.total, 49950000);
}
eq("16 precious metals cannot be left out -> yes", run([dep(49950000), row("movables", {place:"fr", kind:"metal"}, 90000, {excl:true})]).code, "yes");
{
  // 2-3 (a): art under 10万 per item need not be listed, but counts toward the total (decision 2026-11-24, FAQ Q27)
  const art = row("movables", {place:"fr", kind:"art"}, 540000, {excl:true});
  eq("17 art cannot be left out of the total", E.rowExcludable(art), false);
  const r = run([dep(49500000), art]);
  eq("17 4,950万 + art 54万 -> 5,004万", r.total, 50040000); eq("17 -> yes", r.code, "yes");
  eq("17b other movables are still excludable", E.rowExcludable(row("movables", {place:"fr", kind:"other"}, 1)), true);
}
// 2-3 (b): vessels by registry
eq("18 Japanese-registered yacht kept abroad -> domestic", E.rowVerdict(row("vessel", {registry:"jp"}, 60000000)), "domestic");
eq("18 -> no", run([row("vessel", {registry:"jp"}, 60000000)]).code, "no");
eq("18b foreign-registered vessel -> foreign -> yes", run([row("vessel", {registry:"fr"}, 60000000)]).code, "yes");
eq("18c unanswered -> pending", run([row("vessel", {}, 60000000)]).code, "pending");
// 2-3 (c): business, mining, fishing rights by their location
eq("19 business rights at a foreign office -> yes", run([row("other", {sub:"business", where:"fr"}, 60000000)]).code, "yes");
eq("19b mining rights in Japan -> no", run([row("other", {sub:"mining", where:"jp"}, 60000000)]).code, "no");
eq("19c fishing rights abroad -> yes", run([row("other", {sub:"fishing", where:"fr"}, 60000000)]).code, "yes");
eq("19d residual -> holder's address (domestic)", E.rowVerdict(row("other", {sub:"residual"}, 1)), "domestic");
check("named categories include vessel (8)", E.RULES.namedCats.length === 8 && E.RULES.namedCats.includes("vessel"));

/* ---------- deadlines and last bank day ---------- */
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
for(const [y, want] of [[2022, "2023-03-15"], [2023, "2024-07-01"], [2025, "2026-06-30"], [2026, "2027-06-30"], [2028, "2029-07-02"], [2029, "2030-07-01"]]){
  eq("deadline " + y, iso(E.deadlineOf(y).actual), want);
}
for(const [y, want] of [[2023, "2023-12-29"], [2025, "2025-12-30"], [2026, "2026-12-30"], [2028, "2028-12-29"], [2029, "2029-12-28"]]){
  eq("last bank day " + y, iso(E.lastBankDay(y)), want);
}

/* ---------- sources and wording ---------- */
eq("basis: tax answer", E.RULES.basis.taxanswer, "令和8年4月1日現在法令等");
eq("basis: FAQ", E.RULES.basis.faq, "令和8年8月版");
check("basis in English for the English page", /2026/.test(E.RULES.basis.taxanswerEn) && /August 2026/.test(E.RULES.basis.faqEn));
check("FAQ link: current edition", E.RULES.sources.some(s => /kokugai_faq\.pdf$/.test(s.url)) && !E.RULES.sources.some(s => /kokugai_faq_r6\.pdf/.test(s.url)));
check("English footer uses English basis", /tb: en \? RULES\.basis\.taxanswerEn : RULES\.basis\.taxanswer/.test(html));
check("where to file: liable for income tax (ja)", /その年分の所得税の納税義務がある方は/.test(E.I18N.ja["r.deadlineBody"]) && !/確定申告をする方（またはできる方）/.test(E.I18N.ja["r.deadlineBody"]));
check("where to file (en)", /if you are liable for income tax for that year/.test(E.I18N.en["r.deadlineBody"]));
check("art note: listed or not, counts toward the total (ja)", /合計額に含めます/.test(E.I18N.ja["q.movables.kind.art.n"]));
// CRO point 3: the FAQ says only "other movables" may be left out; counting art is this tool's reading
check("movables note: FAQ and this tool's rule are separated (ja)",
      /合計額から除いてよいとされているのは「その他の動産」だけです（FAQ 問27）。書画骨とう・美術工芸品は家庭にあるものも「その他の動産」に入らないため、このツールでは合計額に含めて判定します。/.test(E.I18N.ja["q.movables.kind.note"]));
check("movables note (en)", /^Only two kinds have a small-item exemption from listing/.test(E.I18N.en["q.movables.kind.note"]) && /so this tool counts them toward the total/.test(E.I18N.en["q.movables.kind.note"]));
check("art note says this tool counts it (ja/en)", /このツールでは提出義務の判定の合計額に含めます/.test(E.I18N.ja["q.movables.kind.art.n"]) && /this tool still counts them/.test(E.I18N.en["q.movables.kind.art.n"]));
// CRO point 1: guidance on the storage question, visible whichever place is chosen
check("storage question points vessels to their own category (ja)", /船舶・航空機は保管の場所ではなく船籍・登録の場所で決まります。「船舶・航空機」の区分で入れてください。/.test(E.I18N.ja["q.movables.place.note"]));
check("storage question note (en)", /Vessels and aircraft are located where they are registered/.test(E.I18N.en["q.movables.place.note"]));
check("the storage question is always asked (no 'when')", !E.RULES.categories.movables.questions.find(q => q.id === "place").when);
check("question notes are looked up as q.<cat>.<id>.note", /let noteKey = "q\." \+ r\.cat \+ "\." \+ q\.id \+ "\.note";/.test(html));
// CRO point 2: caution only (the inheritance tax circular could not be confirmed to apply to the report)
{
  const c = "事業の売掛金は、区分によって判定が変わることがあります。税理士に確かめてください";
  check("caution on business rights (ja)", E.I18N.ja["q.other.sub.business.n"] === c);
  check("caution on loans (ja)", E.I18N.ja["q.loan.debtor.note"].includes(c));
  check("caution (en)", /may be judged differently depending on the category\. Check with a tax accountant/.test(E.I18N.en["q.other.sub.business.n"]) && /Check with a tax accountant/.test(E.I18N.en["q.loan.debtor.note"]));
  check("no categorical claim about receivables", !/売掛金はここに入れます/.test(html));
}
// CRO points 4, 5, 8
check("residual note: coast nearest the fishing ground (ja)", /（営業所・鉱区・採石場・漁場に最も近い沿岸など）/.test(E.I18N.ja["q.other.residualNote"]));
check("residual note (en)", /^Each of the assets above is located by its own rule/.test(E.I18N.en["q.other.residualNote"]) && /Only assets that fit none of them/.test(E.I18N.en["q.other.residualNote"]));
check("no internal words in the published source", !/本人の決定/.test(html));
check("README: other movables only", /その他の動産の10万円未満除外に対応（書画骨とうは記載不要でも合計に含める）/.test(readme));
check("no vessels in other movables", !/船舶/.test(E.I18N.ja["q.movables.kind.other"]) && !/vessel/i.test(E.I18N.en["q.movables.kind.other"]));
for(const k of ["cat.vessel", "q.vessel.registry", "q.vessel.registry.jp", "q.vessel.registry.fr", "q.vessel.registry.note",
                "q.other.sub.business", "q.other.sub.mining", "q.other.sub.fishing",
                "q.other.where.business", "q.other.where.mining", "q.other.where.fishing", "q.movables.kind.art.n"]){
  check("key " + k + " in ja and en", (k in E.I18N.ja) && (k in E.I18N.en));
}
check("README: content date and editions", /2026年11月24日時点/.test(readme) && /令和8年4月1日現在法令等/.test(readme) && /令和8年8月版/.test(readme));
check("README: 8 categories", /8区分/.test(readme) && !/7区分/.test(readme));

/* ---------- dictionaries ---------- */
{
  const ja = Object.keys(E.I18N.ja), en = Object.keys(E.I18N.en);
  eq("I18N key count ja = en", ja.length, en.length);
  const missEn = ja.filter(k => !(k in E.I18N.en)), missJa = en.filter(k => !(k in E.I18N.ja));
  check("every ja key is in en", missEn.length === 0, missEn.join(","));
  check("every en key is in ja", missJa.length === 0, missJa.join(","));
  const jpRe = /[぀-ヿ㐀-鿿！-）＋-｠]/;
  const jpInEn = en.filter(k => typeof E.I18N.en[k] === "string" && jpRe.test(E.I18N.en[k]));
  check("no Japanese left in the English dictionary", jpInEn.length === 0, jpInEn.join(","));
  // every question and option of every category has a label
  for(const [cat, c] of Object.entries(E.RULES.categories)){
    for(const q of c.questions){
      for(const o of q.opts){
        const key = (cat === "other" && q.id === "where") ? "q.other.where." + o : "q." + cat + "." + q.id + "." + o;
        check("label " + key, key in E.I18N.ja && key in E.I18N.en);
      }
    }
  }
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
