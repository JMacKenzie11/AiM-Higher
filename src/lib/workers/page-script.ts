// The page listing a worker reads (0303): every element worth naming on
// the page, one per line, each with a ref the worker can click or fill
// ("button \"Search\" [ref_4]"), as the browser tool's read_page member
// expects.
//
// Plain JavaScript in a string, run inside the page by page.evaluate.
// A function would be serialised with whatever helpers the bundler
// added to it, and those do not exist in the page.
//
// Refs are written onto the elements (data-aims-ref) so a later click
// finds the same element. Numbering continues from `next`, which the
// server keeps for each tab, so a ref given out is never given to a
// different element after the tab navigates.
//
// Arguments: { next, filter: "visible" | "interactive" | "all",
// depth, root }. Returns { lines, next, truncated }.

export const LIST_PAGE_SCRIPT = String.raw`(function (args) {
  var MAX = 50000;
  var next = args.next;
  var filter = args.filter;
  var maxDepth = args.depth;
  var INTERACTIVE = { a: "link", button: "button", select: "combobox", textarea: "textbox", summary: "button", option: "option" };
  var INPUT_ROLES = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", image: "button", range: "slider", search: "searchbox" };
  var ROLE_INTERACTIVE = { button: 1, link: 1, checkbox: 1, radio: 1, switch: 1, tab: 1, menuitem: 1, option: 1, combobox: 1, textbox: 1, searchbox: 1, slider: 1, spinbutton: 1, menuitemcheckbox: 1, menuitemradio: 1 };
  var GROUPS = { nav: "navigation", main: "main", form: "form", header: "banner", footer: "contentinfo", aside: "complementary", dialog: "dialog", ul: "list", ol: "list", table: "table", section: "region", article: "article" };

  function clean(s, n) {
    s = (s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function roleOf(el) {
    var r = el.getAttribute("role");
    if (r) return r.split(" ")[0];
    var tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "input") {
      var t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "hidden") return null;
      return INPUT_ROLES[t] || "textbox";
    }
    if (INTERACTIVE[tag]) return INTERACTIVE[tag];
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return el.getAttribute("alt") ? "img" : null;
    if (el.isContentEditable && el.parentElement && !el.parentElement.isContentEditable) return "textbox";
    return null;
  }
  function labelFor(el) {
    var aria = el.getAttribute("aria-label");
    if (aria) return aria;
    var by = el.getAttribute("aria-labelledby");
    if (by) {
      var parts = by.split(" ").map(function (id) { var n = document.getElementById(id); return n ? n.innerText : ""; });
      var joined = parts.join(" ").trim();
      if (joined) return joined;
    }
    if (el.id) {
      var lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab && lab.innerText.trim()) return lab.innerText;
    }
    var wrap = el.closest("label");
    if (wrap && wrap.innerText.trim()) return wrap.innerText;
    return "";
  }
  function nameOf(el, role) {
    var tag = el.tagName.toLowerCase();
    if (tag === "img") return el.getAttribute("alt") || "";
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return labelFor(el) || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "";
    }
    var l = labelFor(el);
    if (l) return l;
    var text = el.innerText || el.textContent || "";
    if (!text.trim()) {
      var img = el.querySelector("img[alt]");
      if (img) text = img.getAttribute("alt");
    }
    return text || el.getAttribute("title") || "";
  }
  function shown(el) {
    var st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  }
  function inViewport(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }
  function refFor(el) {
    var ref = el.getAttribute("data-aims-ref");
    if (!ref) { ref = "ref_" + next++; el.setAttribute("data-aims-ref", ref); }
    return ref;
  }

  var root = document.body;
  if (args.root) {
    root = document.querySelector('[data-aims-ref="' + args.root + '"]');
    if (!root) return { error: "Error: " + args.root + " is stale or not found on the current page. Re-read the page to get fresh references.", next: next };
  }
  var lines = [];
  var size = 0;
  var truncated = false;

  function add(line) {
    if (truncated) return;
    if (size + line.length + 1 > MAX) { truncated = true; return; }
    lines.push(line);
    size += line.length + 1;
  }

  function walk(el, depth) {
    if (truncated || !el || el.nodeType !== 1) return;
    var tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template" || tag === "svg") return;
    if (!shown(el)) return;
    var role = roleOf(el);
    var interactive = role && (ROLE_INTERACTIVE[role] === 1);
    var here = depth;
    var wanted = false;
    if (role) {
      if (filter === "interactive") wanted = interactive && inViewport(el);
      else if (filter === "all") wanted = true;
      else wanted = inViewport(el);
    } else if (filter !== "interactive") {
      // A run of text with no element of its own: a price, a rating.
      var own = "";
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.nodeType === 3) own += c.textContent;
      }
      own = clean(own, 160);
      if (own.length > 1 && (filter === "all" || inViewport(el))) {
        add(new Array(Math.min(depth, maxDepth) + 1).join("  ") + 'text "' + own.replace(/"/g, "'") + '"');
      }
    }
    if (wanted) {
      var name = clean(nameOf(el, role), 120).replace(/"/g, "'");
      var extra = "";
      if (tag === "input" || tag === "textarea") {
        var t = (el.getAttribute("type") || "").toLowerCase();
        if (t === "checkbox" || t === "radio") extra = el.checked ? " checked" : " unchecked";
        else if (el.value) extra = ' value="' + clean(el.value, 80).replace(/"/g, "'") + '"';
      } else if (tag === "select" && el.selectedOptions && el.selectedOptions[0]) {
        extra = ' value="' + clean(el.selectedOptions[0].text, 80).replace(/"/g, "'") + '"';
      } else if (tag === "a" && el.getAttribute("href")) {
        var href = el.getAttribute("href");
        if (!/^javascript:/i.test(href)) extra = " href=" + clean(href, 120);
      }
      if (el.disabled) extra += " disabled";
      add(new Array(Math.min(depth, maxDepth) + 1).join("  ") + role + ' "' + name + '"' + extra + " [" + refFor(el) + "]");
      // A link's, button's or heading's own text is its name: no need to
      // list it again.
      if (interactive || role === "heading" || role === "img") return;
    }
    var group = GROUPS[tag] || (el.getAttribute("role") === "dialog" ? "dialog" : null);
    if (group && !role) here = depth + 1;
    for (var k = 0; k < el.children.length; k++) walk(el.children[k], here);
    if (el.shadowRoot) for (var s = 0; s < el.shadowRoot.children.length; s++) walk(el.shadowRoot.children[s], here);
  }

  walk(root, 0);
  return { lines: lines, next: next, truncated: truncated };
})`;

// What a press would hit (step 2): the element by ref, at a point, or
// the field that has focus (for Enter), described for press.ts.
// Arguments: { ref?, x?, y?, focused? }. Returns a PressTarget plus the
// text of the form's submit button, or null.
export const PRESS_TARGET_SCRIPT = String.raw`(function (args) {
  var el = null;
  if (args.ref) el = document.querySelector('[data-aims-ref="' + args.ref + '"]');
  else if (args.focused) el = document.activeElement;
  else el = document.elementFromPoint(args.x, args.y);
  if (!el || el === document.body) return null;
  var hit = el.closest("button, a[href], input, [role=button], select, textarea, summary") || el;
  function words(e) {
    if (!e) return "";
    return (e.getAttribute("aria-label") || e.innerText || e.value || e.getAttribute("title") || e.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
  }
  var form = hit.form || hit.closest("form");
  var searchy = function (e) {
    if (!e) return false;
    var s = ((e.getAttribute("role") || "") + " " + (e.getAttribute("type") || "") + " " + (e.getAttribute("name") || "") + " " + (e.getAttribute("placeholder") || "") + " " + (e.getAttribute("aria-label") || "") + " " + (e.getAttribute("action") || "") + " " + (e.id || "") + " " + (e.className && e.className.baseVal === undefined ? e.className : "")).toLowerCase();
    return /search|(^|[^a-z])q([^a-z]|$)/.test(s);
  };
  var searchForm = searchy(form) || searchy(hit) || (form ? !!form.querySelector("input[type=search]") : false);
  var submit = form ? form.querySelector("button[type=submit], input[type=submit], button:not([type])") : null;
  return {
    tag: hit.tagName.toLowerCase(),
    type: (hit.getAttribute("type") || "").toLowerCase(),
    role: (hit.getAttribute("role") || "").toLowerCase(),
    text: words(hit).slice(0, 160),
    href: hit.getAttribute("href"),
    inForm: !!form,
    searchForm: searchForm,
    submitText: submit ? words(submit).slice(0, 160) || null : null
  };
})`;
