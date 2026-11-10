// Run from any directory: node ai-production-notes/tests/check.mjs [--unit-only]
// No dependencies, network calls, browser installation, or generated files.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const app = require(resolve(root, "app.js"));
let passed = 0;
let failed = 0;
function test(name, action) {
  try { action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

test("가상 월 비용: 초기값·최솟값·최댓값·소수 단가", () => {
  assert.equal(app.calculateMonthlyCost("1000", "3").cost, 90000);
  assert.equal(app.calculateMonthlyCost(100, 0).cost, 0);
  assert.equal(app.calculateMonthlyCost(10000, 1000).cost, 300000000);
  assert.equal(app.calculateMonthlyCost(1000, 0.1).cost, 3000);
  assert.equal(app.calculateMonthlyCost(2000, 3).cost, 2 * app.calculateMonthlyCost(1000, 3).cost);
});
test("빈값·음수·NaN·무한대·범위·step 위반은 한국어 오류", () => {
  for (const value of ["", " ", -1, NaN, Infinity, "abc", null, undefined, true, {}, "<script>"]) {
    for (const result of [app.calculateMonthlyCost(value, 3), app.calculateMonthlyCost(1000, value)]) {
      assert.equal(result.ok, false, `거부되어야 하는 값: ${String(value)}`);
      assert.match(result.error, /[가-힣]/);
      assert.equal(result.cost, undefined);
    }
  }
  for (const [requests, cost] of [[99, 3], [10001, 3], [150, 3], [1000, 1001], [1000, 0.15]]) {
    assert.equal(app.calculateMonthlyCost(requests, cost).ok, false);
  }
});
test("트래픽 비율 합계 100%, 롤백은 새 버전 0%", () => {
  for (let value = 0; value <= 100; value += 10) {
    const result = app.trafficSplit(String(value));
    assert.equal(result.stable + result.canary, 100);
    assert.equal(result.canary, value);
  }
  assert.deepEqual(app.trafficSplit(0), { ok: true, stable: 100, canary: 0 });
  for (const value of ["", -10, 110, 15, NaN]) assert.equal(app.trafficSplit(value).ok, false);
});
test("가상 trace 데이터와 근거 대조 설명", () => {
  assert.deepEqual(app.TRACE_LABELS, ["문서 검색", "요약 생성", "결과 저장"]);
  assert.deepEqual(app.TRACES.normal.seconds, [0.3, 1.2, 0.2]);
  assert.deepEqual(app.TRACES.slow.seconds, [0.3, 4.8, 0.2]);
  assert.deepEqual(app.TRACES.wrong.seconds, app.TRACES.normal.seconds);
  assert.match(app.TRACES.wrong.explanation, /근거 대조/);
  for (const trace of Object.values(app.TRACES)) assert.match(trace.explanation, /가상/);
});
test("읽기 진행률 범위와 스크롤 없는 문서", () => {
  assert.equal(app.readingProgress(0, 2000, 1000), 0);
  assert.equal(app.readingProgress(500, 2000, 1000), 50);
  assert.equal(app.readingProgress(1500, 2000, 1000), 100);
  assert.equal(app.readingProgress(-10, 2000, 1000), 0);
  assert.equal(app.readingProgress(0, 1000, 1000), 0);
  assert.equal(app.readingProgress(NaN, 2000, 1000), 0);
});

// Small explicit DOM doubles test event wiring, not browser rendering.
function element(attributes = {}) {
  const attrs = { ...attributes };
  const listeners = {};
  const classes = new Set();
  return {
    id: attrs.id, value: attrs.value || "", textContent: "", style: {}, dataset: {},
    classList: { toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key) },
    setAttribute: (key, value) => { attrs[key] = String(value); },
    getAttribute: key => attrs[key] ?? null,
    removeAttribute: key => { delete attrs[key]; },
    addEventListener: (event, fn) => { (listeners[event] ||= []).push(fn); },
    emit: event => { for (const fn of listeners[event] || []) fn(); },
    getBoundingClientRect: () => ({ top: 500 }),
    querySelector: () => null
  };
}
function fixture(withObserver = true) {
  const ids = Object.fromEntries([
    "traffic", "traffic-value", "stable-bar", "canary-bar", "stable-label", "canary-label", "traffic-note", "rollback",
    "trace-title", "trace-explanation", "requests", "requests-value", "unit-cost", "monthly-cost", "cost-formula", "cost-error", "reading-progress"
  ].map(id => [id, element({ id })]));
  ids.traffic.value = "10";
  ids.requests.value = "1000";
  ids["unit-cost"].value = "3";
  const buttons = ["normal", "slow", "wrong"].map(key => Object.assign(element(), { dataset: { trace: key } }));
  const rows = app.TRACE_LABELS.map(() => {
    const fill = element(); const time = element();
    return Object.assign(element(), { fill, time, querySelector: selector => selector === ".trace-fill" ? fill : time });
  });
  let scrollTop = 0;
  const links = Array.from({ length: 6 }, (_, i) => element({ href: `#s${i + 1}` }));
  for (let i = 1; i <= 6; i++) {
    ids[`s${i}`] = element({ id: `s${i}` });
    ids[`s${i}`].getBoundingClientRect = () => ({ top: 200 + (i - 1) * 600 - scrollTop });
  }
  const scrollingElement = { get scrollTop() { return scrollTop; }, scrollHeight: 4400 };
  const doc = {
    getElementById: id => ids[id] || null,
    querySelectorAll: selector => ({ '.toc a[href^="#"]': links, ".trace-controls button[data-trace]": buttons, ".trace-timeline .trace-row": rows })[selector] || [],
    scrollingElement
  };
  const win = Object.assign(element(), { innerHeight: 800, requestAnimationFrame: fn => fn() });
  const observed = [];
  if (withObserver) win.IntersectionObserver = class { observe(node) { observed.push(node); } };
  app.init(doc, win);
  return { ids, buttons, rows, links, win, observed, scroll(value) { scrollTop = value; win.emit("scroll"); } };
}
test("트래픽 input 및 롤백 click이 막대·라벨·안내 동기화", () => {
  const { ids } = fixture();
  assert.equal(ids["stable-bar"].style.width, "90%");
  ids.traffic.value = "70"; ids.traffic.emit("input");
  assert.equal(ids["canary-bar"].style.width, "70%");
  assert.equal(ids["stable-label"].textContent, "안정 버전 30%");
  ids.rollback.emit("click");
  assert.equal(ids.traffic.value, "0");
  assert.equal(ids["traffic-value"].textContent, "0%");
  assert.equal(ids["stable-bar"].style.width, "100%");
  assert.match(ids["traffic-note"].textContent, /가상 롤백/);
});
test("trace 버튼 전환: aria-pressed 하나, 공통 축 막대, 시간·해설", () => {
  const { ids, buttons, rows } = fixture();
  for (const [index, key] of ["normal", "slow", "wrong"].entries()) {
    buttons[index].emit("click");
    assert.equal(buttons.filter(button => button.getAttribute("aria-pressed") === "true").length, 1);
    assert.equal(buttons[index].getAttribute("aria-pressed"), "true");
    rows.forEach((row, i) => {
      assert.equal(row.time.textContent, `${app.TRACES[key].seconds[i].toFixed(1)}초`);
      assert.ok(Math.abs(parseFloat(row.fill.style.width) - app.TRACES[key].seconds[i] / 4.8 * 100) < 1e-8);
    });
    assert.equal(ids["trace-explanation"].textContent, app.TRACES[key].explanation);
  }
});
test("비용 입력 오류에서 낡은 결과를 숨기고 수정 시 회복", () => {
  const { ids } = fixture();
  assert.equal(ids["monthly-cost"].textContent, "90,000");
  ids["unit-cost"].value = ""; ids["unit-cost"].emit("input");
  assert.equal(ids["monthly-cost"].textContent, "—");
  assert.equal(ids["unit-cost"].getAttribute("aria-invalid"), "true");
  assert.match(ids["cost-error"].textContent, /입력/);
  assert.match(ids["unit-cost"].getAttribute("aria-describedby"), /cost-error/);
  ids["unit-cost"].value = "0"; ids["unit-cost"].emit("input");
  assert.equal(ids["monthly-cost"].textContent, "0");
  assert.equal(ids["cost-error"].textContent, "");
  assert.equal(ids["unit-cost"].getAttribute("aria-invalid"), "false");
});
test("목차·읽기 진행률 및 IntersectionObserver 없는 폴백", () => {
  for (const enabled of [true, false]) {
    const context = fixture(enabled);
    assert.equal(context.observed.length, enabled ? 6 : 0);
    context.scroll(1400);
    assert.equal(context.links[2].getAttribute("aria-current"), "location");
    assert.equal(context.links.filter(link => link.getAttribute("aria-current")).length, 1);
    assert.ok(parseFloat(context.ids["reading-progress"].style.width) > 0);
    context.scroll(3600);
    assert.equal(context.ids["reading-progress"].style.width, "100%");
    assert.equal(context.links[5].getAttribute("aria-current"), "location");
  }
  assert.doesNotThrow(() => app.init({ getElementById: () => null, querySelectorAll: () => [] }, {}));
});

// A lightweight static tag scanner for this dependency-free document's contract.
// It is intentionally not a full HTML conformance validator.
function scanHTML(html) {
  const nodes = []; const stack = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const tags = /<\/?([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (const match of clean.matchAll(tags)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith("</")) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index >= 0) {
        stack[index].content = clean.slice(stack[index].contentStart, match.index);
        stack.splice(index);
      }
      continue;
    }
    const attrs = {};
    for (const attr of match[2].matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? "";
    }
    const node = { tag, attrs, parent: stack.at(-1), content: "", contentStart: match.index + match[0].length };
    nodes.push(node);
    if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && !match[0].endsWith("/>")) stack.push(node);
  }
  return nodes;
}
const hasClass = (node, name) => (node?.attrs.class || "").split(/\s+/).includes(name);
const text = node => node.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    // Git metadata is local repository state, not part of the published site.
    if (entry.name === ".git" && entry.isDirectory()) return [];
    const path = resolve(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `심볼릭 링크는 배포 검사 대상에서 허용하지 않음: ${entry.name}`);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
function localTarget(ref, source) {
  const raw = ref.replace(/&amp;/g, "&");
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("//")) return null;
  assert.ok(!raw.startsWith("/"), `GitHub Pages 하위 경로에서 깨질 절대경로: ${ref}`);
  const [path, fragment] = raw.split("#");
  const target = path.split("?")[0] ? resolve(dirname(source), decodeURIComponent(path.split("?")[0])) : source;
  assert.ok(!relative(root, target).startsWith(".."), `사이트 밖 경로: ${ref}`);
  return { target, fragment: fragment ? decodeURIComponent(fragment) : "" };
}

if (!process.argv.includes("--unit-only")) {
  test("필수 파일과 공개 파일목록: PDF·비밀 파일 없음", () => {
    for (const file of ["index.html", "styles.css", "app.js", "SOURCES.md", "tests/check.mjs"]) {
      assert.ok(existsSync(resolve(root, file)), `필수 파일 없음: ${file}`);
    }
    const files = walk(root);
    for (const path of files) {
      const name = relative(root, path).replaceAll("\\", "/");
      assert.ok(!/(^|\/)(?:\.env(?:\..*)?|\.git|\.task-notes|node_modules|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)(\/|$)|\.(pdf|pem|p12|pfx|key)$/i.test(name), `공개 제외 파일: ${name}`);
      if (/\.(html|css|js|mjs|md|json|txt)$/i.test(name)) {
        const contents = readFileSync(path, "utf8");
        assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(contents), `비밀 패턴 발견: ${name}`);
      }
    }
    console.log(`  파일목록: ${files.map(path => relative(root, path)).join(", ")}`);
  });
  if (existsSync(resolve(root, "index.html"))) {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    const nodes = scanHTML(html);
    const byId = id => {
      const found = nodes.filter(node => node.attrs.id === id);
      assert.equal(found.length, 1, `#${id} 정확히 하나 필요`);
      return found[0];
    };
    test("중복 ID·내부 anchor·로컬 자산 및 CSS url", () => {
      const ids = nodes.map(node => node.attrs.id).filter(Boolean);
      assert.equal(new Set(ids).size, ids.length, "중복 ID");
      const references = nodes.flatMap(node => [node.attrs.href, node.attrs.src, node.attrs.poster].filter(Boolean).map(ref => ({ ref, source: resolve(root, "index.html") })));
      for (const path of walk(root).filter(path => extname(path) === ".css")) {
        for (const match of readFileSync(path, "utf8").matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) references.push({ ref: match[1], source: path });
      }
      for (const { ref, source } of references) {
        assert.ok(!/^(?:javascript|vbscript):/i.test(ref), `안전하지 않은 URL: ${ref}`);
        const local = localTarget(ref, source);
        if (!local) continue;
        assert.ok(existsSync(local.target), `로컬 자산 없음: ${ref}`);
        assert.ok(statSync(local.target).isFile(), `파일이 아닌 경로: ${ref}`);
        if (local.fragment && extname(local.target) === ".html") {
          const targetNodes = local.target === resolve(root, "index.html") ? nodes : scanHTML(readFileSync(local.target, "utf8"));
          assert.ok(targetNodes.some(node => node.attrs.id === local.fragment), `anchor 대상 없음: ${ref}`);
        }
      }
    });
    test("문서 구조와 defer 로딩: JS 없이 본문 접근 가능", () => {
      assert.equal(nodes.find(node => node.tag === "html")?.attrs.lang, "ko");
      assert.ok(nodes.some(node => node.tag === "meta" && node.attrs.name === "viewport"));
      assert.equal(byId("main").tag, "main");
      for (let i = 1; i <= 6; i++) {
        assert.ok(hasClass(byId(`s${i}`), "chapter"));
        assert.ok(text(byId(`s${i}`)).length > 100, `#s${i} 본문 필요`);
        assert.ok(nodes.some(node => node.tag === "a" && node.attrs.href === `#s${i}`));
      }
      byId("sources"); byId("reading-progress");
      const scripts = nodes.filter(node => node.tag === "script");
      assert.equal(scripts.length, 1);
      assert.ok(/^(?:\.\/)?app\.js$/.test(scripts[0].attrs.src));
      assert.ok(Object.hasOwn(scripts[0].attrs, "defer"));
      assert.ok(!nodes.some(node => hasClass(node, "js-only")));
      assert.ok(!nodes.some(node => Object.keys(node.attrs).some(attr => /^on[a-z]+$/.test(attr))), "inline event handler 금지");
      assert.ok(!/\b(?:innerHTML|outerHTML)\s*=|document\.write\s*\(/.test(readFileSync(resolve(root, "app.js"), "utf8")), "textContent 사용");
    });
    test("입력 DOM 계약·초기값·label·live region", () => {
      for (const [id, attrs] of Object.entries({
        traffic: { type: "range", min: "0", max: "100", step: "10", value: "10" },
        requests: { type: "range", min: "100", max: "10000", step: "100", value: "1000" },
        "unit-cost": { type: "number", min: "0", max: "1000", step: "0.1", value: "3" }
      })) {
        assert.equal(byId(id).tag, "input");
        for (const [key, value] of Object.entries(attrs)) assert.equal(byId(id).attrs[key], value, `${id}.${key}`);
        assert.ok(nodes.some(node => node.tag === "label" && node.attrs.for === id), `${id} label`);
      }
      assert.equal(byId("traffic-value").tag, "output");
      assert.match(text(byId("traffic-value")), /10\s*%/);
      assert.equal(text(byId("requests-value")), "1,000");
      assert.equal(text(byId("monthly-cost")), "90,000");
      assert.match(text(byId("stable-label")), /안정 버전\s*90\s*%/);
      assert.match(text(byId("canary-label")), /새 버전\s*10\s*%/);
      assert.match(byId("stable-bar").attrs.style, /width\s*:\s*90%/);
      assert.match(byId("canary-bar").attrs.style, /width\s*:\s*10%/);
      assert.equal(byId("rollback").tag, "button");
      assert.equal(byId("rollback").attrs.type, "button");
      assert.equal(text(byId("rollback")), "이전 버전으로 롤백");
      assert.equal(byId("traffic-note").attrs["aria-live"], "polite");
      assert.equal(byId("trace-explanation").attrs["aria-live"], "polite");
      assert.equal(byId("cost-error").attrs.role, "status");
      assert.ok(text(byId("cost-formula")).length > 0);
    });
    test("trace DOM 계약: 3개 버튼과 행, 초기 시간", () => {
      const buttons = nodes.filter(node => node.tag === "button" && node.attrs["data-trace"]);
      assert.equal(buttons.length, 3);
      ["normal", "slow", "wrong"].forEach((key, index) => {
        const button = buttons.find(node => node.attrs["data-trace"] === key);
        assert.ok(button, key);
        assert.ok(hasClass(button.parent, "trace-controls"));
        assert.equal(button.attrs["aria-pressed"], String(index === 0));
      });
      const rows = nodes.filter(node => hasClass(node, "trace-row"));
      assert.equal(rows.length, 3);
      rows.forEach((row, index) => {
        assert.ok(hasClass(row.parent, "trace-timeline"));
        assert.match(text(row), new RegExp(app.TRACE_LABELS[index]));
        const time = nodes.find(node => node.parent === row && hasClass(node, "trace-time"));
        assert.ok(time, "trace-time 필요");
        assert.equal(text(time), `${app.TRACES.normal.seconds[index].toFixed(1)}초`);
        const track = nodes.find(node => node.parent === row && hasClass(node, "trace-track"));
        assert.ok(track, "trace-track 필요");
        assert.ok(nodes.some(node => node.parent === track && hasClass(node, "trace-fill")));
      });
      assert.ok(text(byId("trace-title")).length > 0);
    });
  } else {
    test("HTML 정적 통합 검증 준비", () => assert.fail("index.html 없음; 독립 계산만 검사하려면 --unit-only 사용"));
  }
}

console.log(`\n${passed}개 통과, ${failed}개 실패${process.argv.includes("--unit-only") ? " (독립 함수·DOM 이벤트 검사만 실행)" : ""}`);
if (failed) process.exitCode = 1;
