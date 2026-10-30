/** A one-page PDF with these lines of text: enough for the app to read, extract and talk about. */
export function tinyPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 10 Tf 40 790 Td 13 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export const PAPER = [
  "Attention Is All You Need",
  "Abstract",
  "The dominant sequence transduction models are based on complex recurrent or convolutional",
  "neural networks that include an encoder and a decoder. The best performing models also connect",
  "the encoder and decoder through an attention mechanism. We propose a new simple network",
  "architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence",
  "and convolutions entirely. Experiments on two machine translation tasks show these models to be",
  "superior in quality while being more parallelizable and requiring significantly less time to train.",
  "Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over",
  "the existing best results, including ensembles, by over 2 BLEU. On the English-to-French task our",
  "model establishes a new single-model state-of-the-art BLEU score of 41.8 after training for 3.5",
  "days on eight GPUs, a small fraction of the training costs of the best models from the literature.",
  "1 Introduction",
  "Recurrent neural networks have been firmly established as state of the art approaches in sequence",
  "modeling and transduction problems such as language modeling and machine translation. Recurrent",
  "models typically factor computation along the symbol positions of the input and output sequences.",
  "This inherently sequential nature precludes parallelization within training examples, which becomes",
  "critical at longer sequence lengths, as memory constraints limit batching across examples.",
];
