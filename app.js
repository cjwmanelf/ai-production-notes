(function () {
  "use strict";

  const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
  const TRACE_LABELS = Object.freeze(["문서 검색", "요약 생성", "결과 저장"]);
  // All timings and costs on this page are illustrative, not production measurements.
  const TRACES = Object.freeze({
    normal: Object.freeze({
      title: "가상 trace · 정상 응답",
      seconds: Object.freeze([0.3, 1.2, 0.2]),
      explanation: "가상 예시입니다. 문서 검색 0.3초, 요약 생성 1.2초, 결과 저장 0.2초로 총 1.7초입니다. 응답 속도와 별개로 답변의 근거와 품질도 평가해야 합니다."
    }),
    slow: Object.freeze({
      title: "가상 trace · 느린 응답",
      seconds: Object.freeze([0.3, 4.8, 0.2]),
      explanation: "가상 예시입니다. 총 5.3초 중 요약 생성이 4.8초를 차지합니다. 이 구간의 모델 호출, 입력 길이와 재시도를 확인할 수 있습니다. trace는 지연 구간을 보여 주며 원인을 확정하지는 않습니다."
    }),
    wrong: Object.freeze({
      title: "가상 trace · 잘못된 답변",
      seconds: Object.freeze([0.3, 1.2, 0.2]),
      explanation: "가상 예시입니다. 정상 응답과 같은 1.7초여도 답변은 틀릴 수 있습니다. 잘못된 답은 속도가 아닌 근거 대조로 발견합니다. 검색 문서와 생성 답변을 대조하고 평가 데이터셋에 실패 사례를 추가합니다."
    })
  });

  function parseNumber(raw, label, min, max, step) {
    if ((typeof raw !== "string" && typeof raw !== "number") || String(raw).trim() === "") {
      return { ok: false, error: `${label}을(를) 입력해 주세요.` };
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false, error: `${label}은(는) 유효한 숫자로 입력해 주세요.` };
    if (value < min || value > max) {
      return { ok: false, error: `${label}은(는) ${numberFormat.format(min)} 이상 ${numberFormat.format(max)} 이하로 입력해 주세요.` };
    }
    const steps = (value - min) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) {
      return { ok: false, error: `${label}은(는) ${step} 단위로 입력해 주세요.` };
    }
    return { ok: true, value };
  }

  function calculateMonthlyCost(requests, unitCost) {
    const daily = parseNumber(requests, "하루 요청 수", 100, 10000, 100);
    const unit = parseNumber(unitCost, "메시지당 변동원가", 0, 1000, 0.1);
    if (!daily.ok || !unit.ok) {
      return { ok: false, error: [daily.error, unit.error].filter(Boolean).join(" "), invalidRequests: !daily.ok, invalidUnitCost: !unit.ok };
    }
    // Price is in tenths of a won; integer arithmetic avoids decimal multiplication noise.
    const cost = daily.value * Math.round(unit.value * 10) * 30 / 10;
    return { ok: true, requests: daily.value, unitCost: unit.value, days: 30, cost };
  }

  function trafficSplit(raw) {
    const parsed = parseNumber(raw, "새 버전 요청 비율", 0, 100, 10);
    return parsed.ok ? { ok: true, stable: 100 - parsed.value, canary: parsed.value } : parsed;
  }

  function readingProgress(scrollTop, scrollHeight, viewportHeight) {
    const distance = scrollHeight - viewportHeight;
    if (![scrollTop, scrollHeight, viewportHeight].every(Number.isFinite) || distance <= 0) return 0;
    return Math.min(100, Math.max(0, scrollTop / distance * 100));
  }

  function initTraffic(doc) {
    const ids = ["traffic", "traffic-value", "stable-bar", "canary-bar", "stable-label", "canary-label", "traffic-note", "rollback"];
    const nodes = ids.map(id => doc.getElementById(id));
    if (nodes.some(node => !node)) return;
    const [input, output, stableBar, canaryBar, stableLabel, canaryLabel, note, rollback] = nodes;
    function render(isRollback = false) {
      const split = trafficSplit(input.value);
      input.setAttribute("aria-invalid", String(!split.ok));
      if (!split.ok) { note.textContent = split.error; return; }
      output.textContent = `${split.canary}%`;
      stableBar.style.width = `${split.stable}%`;
      canaryBar.style.width = `${split.canary}%`;
      stableLabel.textContent = `안정 버전 ${split.stable}%`;
      canaryLabel.textContent = `새 버전 ${split.canary}%`;
      note.textContent = `${isRollback ? "가상 롤백: 이전 안정 버전으로 요청을 모두 돌렸습니다. " : ""}설명용 요청 비율은 안정 버전 ${split.stable}%, 새 버전 ${split.canary}%입니다. 실제 배포나 트래픽 변경은 일어나지 않습니다.`;
    }
    input.addEventListener("input", () => render());
    rollback.addEventListener("click", () => { input.value = "0"; render(true); });
    render();
  }

  function initTraces(doc) {
    const buttons = Array.from(doc.querySelectorAll(".trace-controls button[data-trace]"));
    const rows = Array.from(doc.querySelectorAll(".trace-timeline .trace-row"));
    const title = doc.getElementById("trace-title");
    const explanation = doc.getElementById("trace-explanation");
    if (!title || !explanation || rows.length !== 3 || buttons.length !== 3) return;
    const fills = rows.map(row => row.querySelector(".trace-fill"));
    const times = rows.map(row => row.querySelector(".trace-time"));
    if (fills.some(node => !node) || times.some(node => !node)) return;
    function render(key) {
      if (!Object.prototype.hasOwnProperty.call(TRACES, key)) return;
      const trace = TRACES[key];
      buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.trace === key)));
      title.textContent = trace.title;
      explanation.textContent = trace.explanation;
      trace.seconds.forEach((seconds, index) => {
        // A shared 4.8-second scale makes the same duration comparable across traces.
        fills[index].style.width = `${seconds / 4.8 * 100}%`;
        times[index].textContent = `${seconds.toFixed(1)}초`;
      });
    }
    buttons.forEach(button => button.addEventListener("click", () => render(button.dataset.trace)));
    render("normal");
  }

  function initCost(doc) {
    const ids = ["requests", "requests-value", "unit-cost", "monthly-cost", "cost-formula", "cost-error"];
    const nodes = ids.map(id => doc.getElementById(id));
    if (nodes.some(node => !node)) return;
    const [requests, requestsValue, unitCost, monthlyCost, formula, error] = nodes;
    // Preserve existing descriptions and also connect the validation feedback.
    [requests, unitCost].forEach(input => {
      const describedBy = new Set((input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add("cost-error");
      input.setAttribute("aria-describedby", Array.from(describedBy).join(" "));
    });
    function render() {
      const result = calculateMonthlyCost(requests.value, unitCost.value);
      requests.setAttribute("aria-invalid", String(!result.ok && result.invalidRequests));
      unitCost.setAttribute("aria-invalid", String(!result.ok && result.invalidUnitCost));
      if (!result.ok) {
        error.textContent = result.error;
        monthlyCost.textContent = "—";
        requestsValue.textContent = result.invalidRequests ? "—" : numberFormat.format(Number(requests.value));
        formula.textContent = "입력값을 확인하면 가상 월 변동원가를 계산합니다.";
        return;
      }
      error.textContent = "";
      requestsValue.textContent = numberFormat.format(result.requests);
      monthlyCost.textContent = numberFormat.format(result.cost);
      formula.textContent = `${numberFormat.format(result.requests)}건/일 × ${numberFormat.format(result.unitCost)}원/건 × 30일 = ${numberFormat.format(result.cost)}원/월 (가상 변동원가)`;
    }
    [requests, unitCost].forEach(input => input.addEventListener("input", render));
    render();
  }

  function initReading(doc, win) {
    const progress = doc.getElementById("reading-progress");
    const links = Array.from(doc.querySelectorAll('.toc a[href^="#"]'));
    const sections = links.map(link => doc.getElementById(link.getAttribute("href").slice(1))).filter(Boolean);
    if (!progress && !sections.length) return;
    let scheduled = false;
    function update() {
      scheduled = false;
      const root = doc.scrollingElement || doc.documentElement;
      if (progress) progress.style.width = `${readingProgress(root.scrollTop, root.scrollHeight, win.innerHeight)}%`;
      const marker = Math.min(180, win.innerHeight * 0.25);
      let current = sections[0];
      sections.forEach(section => { if (section.getBoundingClientRect().top <= marker) current = section; });
      if (root.scrollTop > 0 && root.scrollTop + win.innerHeight >= root.scrollHeight - 2) current = sections[sections.length - 1];
      links.forEach(link => {
        const active = Boolean(current && link.getAttribute("href") === `#${current.id}`);
        link.classList.toggle("is-active", active);
        if (active) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      win.requestAnimationFrame(update);
    }
    win.addEventListener("scroll", schedule, { passive: true });
    win.addEventListener("resize", schedule);
    win.addEventListener("load", schedule);
    win.addEventListener("hashchange", schedule);
    if (typeof win.IntersectionObserver === "function") {
      const observer = new win.IntersectionObserver(schedule, { rootMargin: "-15% 0px -65% 0px", threshold: [0, 1] });
      sections.forEach(section => observer.observe(section));
    }
    update();
  }

  function init(doc, win) {
    initTraffic(doc);
    initTraces(doc);
    initCost(doc);
    initReading(doc, win);
  }

  // Node can verify the exact browser calculations without installing dependencies.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TRACE_LABELS, TRACES, parseNumber, calculateMonthlyCost, trafficSplit, readingProgress, init };
  }
  if (typeof document !== "undefined" && typeof window !== "undefined") init(document, window);
})();
