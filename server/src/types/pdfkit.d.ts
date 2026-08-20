// pdfkit ships no types of its own and @types/pdfkit isn't reliably resolvable
// in this environment's npm registry mirror — a minimal ambient declaration is
// enough since emmy-pdf.ts only uses a handful of well-known chainable methods.
declare module "pdfkit" {
  export default class PDFDocument {
    constructor(options?: Record<string, unknown>);
    x: number;
    y: number;
    page: {
      width: number;
      height: number;
      margins: { top: number; bottom: number; left: number; right: number };
    };
    info: Record<string, string>;
    font(name: string): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    lineWidth(width: number): this;
    text(text: string, options?: Record<string, unknown>): this;
    text(text: string, x: number, y: number, options?: Record<string, unknown>): this;
    heightOfString(text: string, options?: Record<string, unknown>): number;
    moveDown(lines?: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    rect(x: number, y: number, width: number, height: number): this;
    fill(color?: string): this;
    stroke(color?: string): this;
    addPage(options?: Record<string, unknown>): this;
    end(): void;
    on(event: string, handler: (...args: any[]) => void): this;
  }
}
