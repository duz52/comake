import type { Presentation } from '../domain/model';
import { createPptxArchive } from '../domain/pptx-exporter';

const pptxMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function downloadPptx(presentation: Presentation): void {
  const archive = createPptxArchive(presentation);
  const archiveBuffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(archiveBuffer).set(archive);

  const objectUrl = URL.createObjectURL(new Blob([archiveBuffer], { type: pptxMimeType }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${presentation.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.pptx`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
