import {
  type Presentation,
  type PresentationElement,
  type ShapeElement,
  type TextElement,
} from '../../types/presentation';

interface ZipFile {
  name: string;
  value: Uint8Array;
}

const encoder = new TextEncoder();
const crcTable = createCrcTable();

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  }
  return (value ^ 0xffffffff) >>> 0;
}

function uint16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function uint32(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function zip(files: ZipFile[]): Uint8Array {
  const localFiles: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const fileName = encoder.encode(file.name);
    const checksum = crc32(file.value);
    const localHeader = concatenate([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(file.value.byteLength),
      uint32(file.value.byteLength),
      uint16(fileName.byteLength),
      uint16(0),
      fileName,
      file.value,
    ]);
    localFiles.push(localHeader);

    centralDirectory.push(
      concatenate([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(checksum),
        uint32(file.value.byteLength),
        uint32(file.value.byteLength),
        uint16(fileName.byteLength),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        fileName,
      ]),
    );

    offset += localHeader.byteLength;
  }

  const directory = concatenate(centralDirectory);
  return concatenate([
    ...localFiles,
    directory,
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(files.length),
    uint16(files.length),
    uint32(directory.byteLength),
    uint32(offset),
    uint16(0),
  ]);
}

function xml(value: string): Uint8Array {
  return encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function color(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

function emu(value: number): number {
  return Math.round(value * 12700);
}

function groupShapeXml(): string {
  return `
    <p:nvGrpSpPr>
      <p:cNvPr id="1" name=""/>
      <p:cNvGrpSpPr/>
      <p:nvPr/>
    </p:nvGrpSpPr>
    <p:grpSpPr>
      <a:xfrm>
        <a:off x="0" y="0"/>
        <a:ext cx="0" cy="0"/>
        <a:chOff x="0" y="0"/>
        <a:chExt cx="0" cy="0"/>
      </a:xfrm>
    </p:grpSpPr>`;
}

function xfrm(element: PresentationElement): string {
  const rotation = element.rotation ? ` rot="${Math.round(element.rotation * 60000)}"` : '';
  return `<a:xfrm${rotation}><a:off x="${emu(element.frame.x)}" y="${emu(element.frame.y)}"/><a:ext cx="${emu(element.frame.width)}" cy="${emu(element.frame.height)}"/></a:xfrm>`;
}

function textXml(element: TextElement, shapeId: number): string {
  const alignment = { left: 'l', center: 'ctr', right: 'r' }[element.style.align ?? 'left'];
  const fontSize = Math.max(800, Math.round(element.style.fontSize * 75));
  const fontWeight = (element.style.fontWeight ?? 400) >= 700 ? ' b="1"' : '';
  const lineHeight = element.style.lineHeight
    ? ` spcPct="${Math.round(element.style.lineHeight * 100000)}"`
    : '';
  const text = element.style.textTransform === 'uppercase' ? element.text.toUpperCase() : element.text;
  const paragraphs = text
    .split('\n')
    .map(
      (line) => `<a:p><a:pPr algn="${alignment}"${lineHeight}/><a:r><a:rPr lang="en-US" sz="${fontSize}"${fontWeight}><a:solidFill><a:srgbClr val="${color(element.style.color)}"/></a:solidFill><a:latin typeface="${escapeXml(element.style.fontFamily.split(',')[0])}"/></a:rPr><a:t>${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`,
    )
    .join('');

  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(element.name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr>${xfrm(element)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
    <p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${paragraphs}</p:txBody>
  </p:sp>`;
}

function shapeXml(element: ShapeElement, shapeId: number): string {
  const preset = element.radius ? 'roundRect' : 'rect';
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(element.name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>${xfrm(element)}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color(element.fill)}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>
  </p:sp>`;
}

function slideXml(presentation: Presentation, slideId: string): Uint8Array {
  const slide = presentation.slides[slideId];
  const elements = slide.elementOrder
    .map((elementId, index) => {
      const element = slide.elements[elementId];
      return element.kind === 'text' ? textXml(element, index + 2) : shapeXml(element, index + 2);
    })
    .join('');

  return xml(`<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:cSld>
      <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color(slide.background)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
      <p:spTree>${groupShapeXml()}${elements}</p:spTree>
    </p:cSld>
    <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
  </p:sld>`);
}

function relationships(items: Array<{ id: string; target: string; type: string }>): Uint8Array {
  return xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(
      (item) => `<Relationship Id="${item.id}" Type="${item.type}" Target="${item.target}"/>`,
    )
    .join('')}</Relationships>`);
}

function contentTypes(slideCount: number): Uint8Array {
  const slideOverrides = Array.from(
    { length: slideCount },
    (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join('');
  return xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
    <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
    <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
    <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
    ${slideOverrides}
  </Types>`);
}

function presentationXml(presentation: Presentation): Uint8Array {
  const ids = presentation.slideOrder
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
    .join('');
  return xml(`<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
    <p:sldIdLst>${ids}</p:sldIdLst>
    <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
    <p:notesSz cx="6858000" cy="9144000"/>
    <p:defaultTextStyle/>
  </p:presentation>`);
}

function slideMasterXml(): Uint8Array {
  return xml(`<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:cSld name="Comake master"><p:spTree>${groupShapeXml()}</p:spTree></p:cSld>
    <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
    <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
    <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
  </p:sldMaster>`);
}

function slideLayoutXml(): Uint8Array {
  return xml(`<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
    <p:cSld name="Blank"><p:spTree>${groupShapeXml()}</p:spTree></p:cSld>
    <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
  </p:sldLayout>`);
}

function themeXml(): Uint8Array {
  return xml(`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Comake">
    <a:themeElements>
      <a:clrScheme name="Comake"><a:dk1><a:srgbClr val="1C1C18"/></a:dk1><a:lt1><a:srgbClr val="F8F2E8"/></a:lt1><a:dk2><a:srgbClr val="4C4A42"/></a:dk2><a:lt2><a:srgbClr val="F4EFE7"/></a:lt2><a:accent1><a:srgbClr val="EC6F42"/></a:accent1><a:accent2><a:srgbClr val="FFD14E"/></a:accent2><a:accent3><a:srgbClr val="65765B"/></a:accent3><a:accent4><a:srgbClr val="5A697D"/></a:accent4><a:accent5><a:srgbClr val="AD9170"/></a:accent5><a:accent6><a:srgbClr val="C7B9A8"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
      <a:fontScheme name="Comake"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
      <a:fmtScheme name="Comake"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/><a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme>
    </a:themeElements>
  </a:theme>`);
}

function corePropertiesXml(): Uint8Array {
  const timestamp = new Date().toISOString();
  return xml(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Comake</dc:creator><cp:lastModifiedBy>Comake</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`);
}

function appPropertiesXml(slideCount: number): Uint8Array {
  return xml(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Comake</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Slides</vt:lpstr></vt:variant><vt:variant><vt:i4>${slideCount}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${slideCount}" baseType="lpstr">${Array.from({ length: slideCount }, () => '<vt:lpstr>Slide</vt:lpstr>').join('')}</vt:vector></TitlesOfParts><Company>Comake</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>`);
}

export function createPptxArchive(presentation: Presentation): Uint8Array {
  const slideFiles = presentation.slideOrder.flatMap((slideId, index) => [
    {
      name: `ppt/slides/slide${index + 1}.xml`,
      value: slideXml(presentation, slideId),
    },
    {
      name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      value: relationships([
        {
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
          target: '../slideLayouts/slideLayout1.xml',
        },
      ]),
    },
  ]);
  const presentationRelationships = [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
      target: 'slideMasters/slideMaster1.xml',
    },
    ...presentation.slideOrder.map((_, index) => ({
      id: `rId${index + 2}`,
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
      target: `slides/slide${index + 1}.xml`,
    })),
  ];
  const files: ZipFile[] = [
    { name: '[Content_Types].xml', value: contentTypes(presentation.slideOrder.length) },
    {
      name: '_rels/.rels',
      value: relationships([
        {
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
          target: 'ppt/presentation.xml',
        },
        {
          id: 'rId2',
          type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
          target: 'docProps/core.xml',
        },
        {
          id: 'rId3',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
          target: 'docProps/app.xml',
        },
      ]),
    },
    { name: 'docProps/core.xml', value: corePropertiesXml() },
    { name: 'docProps/app.xml', value: appPropertiesXml(presentation.slideOrder.length) },
    { name: 'ppt/presentation.xml', value: presentationXml(presentation) },
    { name: 'ppt/_rels/presentation.xml.rels', value: relationships(presentationRelationships) },
    { name: 'ppt/slideMasters/slideMaster1.xml', value: slideMasterXml() },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      value: relationships([
        {
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
          target: '../slideLayouts/slideLayout1.xml',
        },
        {
          id: 'rId2',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
          target: '../theme/theme1.xml',
        },
      ]),
    },
    { name: 'ppt/slideLayouts/slideLayout1.xml', value: slideLayoutXml() },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      value: relationships([
        {
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
          target: '../slideMasters/slideMaster1.xml',
        },
      ]),
    },
    { name: 'ppt/theme/theme1.xml', value: themeXml() },
    ...slideFiles,
  ];
  return zip(files);
}
