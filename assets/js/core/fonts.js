// Fontes disponíveis no editor (Google Fonts). Uma única folha de estilo cobre todas.
export const FONTS = [
  { name: 'Inter', g: 'Inter:wght@300;400;500;600;700;800', cat: 'Sans' },
  { name: 'Poppins', g: 'Poppins:wght@300;400;500;600;700;800', cat: 'Sans' },
  { name: 'Space Grotesk', g: 'Space+Grotesk:wght@300;400;500;700', cat: 'Sans' },
  { name: 'DM Sans', g: 'DM+Sans:wght@300;400;500;700', cat: 'Sans' },
  { name: 'Montserrat', g: 'Montserrat:wght@300;400;500;600;700;800', cat: 'Sans' },
  { name: 'Andika', g: 'Andika:wght@400;700', cat: 'Sans' },
  { name: 'Playfair Display', g: 'Playfair+Display:wght@400;500;700;800', cat: 'Serifa' },
  { name: 'Libre Caslon Text', g: 'Libre+Caslon+Text:wght@400;700', cat: 'Serifa' },
  { name: 'Merriweather', g: 'Merriweather:wght@300;400;700;900', cat: 'Serifa' },
  { name: 'Lora', g: 'Lora:wght@400;500;600;700', cat: 'Serifa' },
  { name: 'DM Serif Display', g: 'DM+Serif+Display', cat: 'Serifa' },
  { name: 'Bebas Neue', g: 'Bebas+Neue', cat: 'Display' },
  { name: 'Anton', g: 'Anton', cat: 'Display' },
  { name: 'Archivo Black', g: 'Archivo+Black', cat: 'Display' },
  { name: 'Caveat', g: 'Caveat:wght@400;500;700', cat: 'Manuscrita' },
  { name: 'Pacifico', g: 'Pacifico', cat: 'Manuscrita' },
  { name: 'Permanent Marker', g: 'Permanent+Marker', cat: 'Manuscrita' },
  { name: 'Cutive Mono', g: 'Cutive+Mono', cat: 'Mono' },
  { name: 'JetBrains Mono', g: 'JetBrains+Mono:wght@300;400;500;700', cat: 'Mono' },
  { name: 'Press Start 2P', g: 'Press+Start+2P', cat: 'Mono' },
];

const loaded = new Set();

export function loadFonts(names) {
  const want = FONTS.filter((f) => names.includes(f.name) && !loaded.has(f.name));
  if (!want.length) return;
  want.forEach((f) => loaded.add(f.name));
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?' + want.map((f) => 'family=' + f.g).join('&') + '&display=swap';
  document.head.append(link);
}

// Endereço da folha de estilo do Google Fonts para esses nomes (ou null se nenhum está na lista). Usado também pela exportação em HTML.
export function urlDasFontes(names) {
  const want = FONTS.filter((f) => names.includes(f.name));
  return want.length ? 'https://fonts.googleapis.com/css2?' + want.map((f) => 'family=' + f.g).join('&') + '&display=swap' : null;
}

export const loadAllFonts = () => loadFonts(FONTS.map((f) => f.name));
export const fontStack = (name) => `'${name}', system-ui, sans-serif`;
