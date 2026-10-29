import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { combine, decodeText, extractFile, htmlToText, markdownToText, MAX_SOURCE_CHARS, subtitleToText } from "../lib/ingest/extract";
import { rewrite } from "../lib/ingest/url";
import { cleanUrl } from "../lib/client/track";
import { parseLinks, publicUrl } from "../lib/client/files";
import { assertPublicAddress, isPublicAddress } from "../lib/server/net";

const para = (n: number) => Array.from({ length: n }, (_, i) => `Sentence ${i} about harness evolution and audience fit.`).join(" ");

test("html: prefers the article, keeps headings and lists, drops chrome and scripts", () => {
  const html = `<html><head><title>Ignored</title><meta property="og:title" content="Real &amp; Title"><script>var x = 1</script></head>
    <body><nav>Home · Pricing</nav><article><h1>Heading</h1><p>${para(12)}</p><ul><li>First</li><li>Second</li></ul></article><footer>© 2026</footer></body></html>`;
  const r = htmlToText(html);
  assert.equal(r.title, "Real & Title");
  assert.match(r.text, /^# Heading/m);
  assert.match(r.text, /^- First$/m);
  assert.doesNotMatch(r.text, /Pricing|var x|© 2026/);
});

test("html: WeChat articles read from #js_content with nested divs", () => {
  const html = `<body><div id="js_content" class="rich"><div><p>${para(10)}</p></div><div><p>Tail paragraph.</p></div></div><div class="qr">Scan me</div></body>`;
  const r = htmlToText(html);
  assert.match(r.text, /Tail paragraph\./);
  assert.doesNotMatch(r.text, /Scan me/);
});

test("markdown: front matter title, no images or link targets", () => {
  const r = markdownToText(`---\ntitle: "Notes"\n---\n# H\n![chart](a.png)\nSee [the paper](https://x.y/z).`);
  assert.equal(r.title, "Notes");
  assert.equal(r.text, "# H\n\nSee the paper.");
});

test("decodeText: UTF-8, GB18030 and UTF-16", () => {
  assert.equal(decodeText(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])), "你好");
  assert.equal(decodeText(strToU8("héllo")), "héllo");
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])), "hi");
});

test("subtitles keep only the spoken lines", () => {
  const srt = "1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:03,500 --> 00:00:05,000\n<i>General</i> Kenobi\n";
  assert.equal(subtitleToText(srt), "Hello there\nGeneral Kenobi");
});

test("docx: headings, lists and runs from word/document.xml", async () => {
  const xml = `<w:document><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly report</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t xml:space="preserve">Revenue </w:t></w:r><w:r><w:t>up &amp; right</w:t></w:r></w:p>
  </w:body></w:document>`;
  const bytes = zipSync({ "word/document.xml": strToU8(xml), "[Content_Types].xml": strToU8("<Types/>") });
  const [d] = await extractFile("report.docx", bytes);
  assert.equal(d.kind, "docx");
  assert.equal(d.text, "# Quarterly report\n\n- Revenue up & right");
});

test("pptx: slides in numeric order with speaker notes", async () => {
  const slide = (t: string) => strToU8(`<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`);
  const bytes = zipSync({
    "ppt/slides/slide2.xml": slide("Second"),
    "ppt/slides/slide10.xml": slide("Tenth"),
    "ppt/slides/slide1.xml": slide("First"),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(`<Relationships><Relationship Target="../notesSlides/notesSlide7.xml"/></Relationships>`),
    "ppt/notesSlides/notesSlide7.xml": strToU8(`<p:notes><a:p><a:r><a:t>Say this</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>`),
  });
  const [d] = await extractFile("deck.pptx", bytes);
  assert.equal(d.kind, "pptx");
  assert.deepEqual(d.text.match(/## Slide \d+\n\w+/g), ["## Slide 1\nFirst", "## Slide 2\nSecond", "## Slide 3\nTenth"]);
  assert.match(d.text, /Notes: Say this/);
});

test("epub: spine order and book title", async () => {
  const bytes = zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>`),
    "OPS/book.opf": strToU8(`<package><metadata><dc:title>A Book</dc:title></metadata><manifest><item id="c2" href="two.xhtml"/><item id="c1" href="one.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`),
    "OPS/one.xhtml": strToU8(`<html><body><h1>One</h1><p>Alpha</p></body></html>`),
    "OPS/two.xhtml": strToU8(`<html><body><h1>Two</h1><p>Beta</p></body></html>`),
  });
  const [d] = await extractFile("book.epub", bytes);
  assert.equal(d.name, "A Book");
  assert.ok(d.text.indexOf("One") < d.text.indexOf("Two"));
});

test("zip: a folder of mixed files expands; junk and unknown binaries are skipped", async () => {
  const bytes = zipSync({
    "notes/a.md": strToU8(`# A\n${para(3)}`),
    "notes/b.html": strToU8(`<body><p>${para(3)}</p></body>`),
    "notes/c.png": new Uint8Array([137, 80, 78, 71]),
    "__MACOSX/notes/._a.md": strToU8("junk"),
    "notes/.DS_Store": strToU8("junk"),
  });
  const docs = await extractFile("notes.zip", bytes);
  assert.deepEqual(docs.map((d) => [d.name, d.kind]), [["notes/a.md", "markdown"], ["notes/b.html", "html"]]);
});

test("combine: one heading per source; over budget, long sources are trimmed and short ones kept whole", () => {
  const short = { name: "short", text: para(5), kind: "markdown" as const, removed: [] };
  const long = { name: "long", text: "x ".repeat(MAX_SOURCE_CHARS), kind: "text" as const, removed: [] };
  const c = combine([short, long], "Folder");
  assert.equal(c.name, "Folder");
  assert.ok(c.text.length <= MAX_SOURCE_CHARS + 100);
  assert.ok(c.text.includes(short.text));
  assert.match(c.text, /^# short/m);
  assert.ok(c.removed.some((r) => r.includes("trimmed")));
  assert.equal(c.items.length, 2);
});

test("links: documented plain-text forms for GitHub and Google Docs", () => {
  assert.equal(rewrite(new URL("https://github.com/LittleA-Agentic-RL-Harness/evocast")).url, "https://raw.githubusercontent.com/LittleA-Agentic-RL-Harness/evocast/HEAD/README.md");
  assert.equal(rewrite(new URL("https://github.com/o/r/blob/main/docs/x.md")).url, "https://raw.githubusercontent.com/o/r/main/docs/x.md");
  assert.equal(rewrite(new URL("https://docs.google.com/document/d/abc123/edit?usp=sharing")).url, "https://docs.google.com/document/d/abc123/export?format=md");
  assert.equal(rewrite(new URL("https://example.com/a?b=1")).url, "https://example.com/a?b=1");
});

test("links: parse lists, never treat prose as links; analytics drop query strings", () => {
  assert.deepEqual(parseLinks("https://a.com/x\nhttps://b.org/y, https://a.com/x"), ["https://a.com/x", "https://b.org/y"]);
  assert.equal(parseLinks("read https://a.com please"), null);
  assert.equal(publicUrl("https://docs.google.com/document/d/1/edit?token=secret#h"), "https://docs.google.com/document/d/1/edit");
  assert.equal(cleanUrl("https://news.ycombinator.com/item?id=42&utm_x=1"), "https://news.ycombinator.com/item?id=42");
  assert.equal(cleanUrl("https://mail.example.com/inbox?session=abc"), "https://mail.example.com/inbox");
});

test("ssrf: only public addresses pass, including IPv6 forms of private ones", async () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.ok(isPublicAddress(ip), ip);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "0.0.0.0", "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "fd00::1", "fe80::1", "not-an-ip"])
    assert.ok(!isPublicAddress(ip), ip);

  const env = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    await assert.rejects(assertPublicAddress("[::ffff:7f00:1]"), /Private or local/);
    await assert.rejects(assertPublicAddress("localhost"), /Private or local/);
    await assertPublicAddress("8.8.8.8");
    Object.assign(process.env, { EVOCAST_DESKTOP: "1" });
    await assertPublicAddress("localhost");
  } finally {
    Object.assign(process.env, { NODE_ENV: env });
    delete process.env.EVOCAST_DESKTOP;
  }
});
