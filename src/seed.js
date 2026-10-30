// Carga inicial con la información comercial del diseño aprobado.
// Es idempotente: no sobrescribe lo que ya se haya editado desde el panel.
import { pool } from './db.js';

export const DEFAULT_SETTINGS = {
  company_name: 'CONNOR Constructora del Noroeste',
  phone_display: '665 653 9053',
  phone_e164: '+526656539053',
  whatsapp_number: '526656539053',
  whatsapp_message: 'Hola, me interesa información sobre sus desarrollos.',
  email: '',
  office_address: '',
  founding_year: '',
  instagram_handle: 'bajaconnor',
  tiktok_handle: 'bajaconnor',
  facebook_name: 'Connor Constructora del Noroeste',
  facebook_url: '',
  hero_eyebrow: 'DESARROLLO INMOBILIARIO · TECATE, B.C.',
  hero_title: 'Construimos más que espacios.',
  hero_title_accent: 'Construimos patrimonio.',
  hero_text: 'Terrenos y fraccionamientos en Tecate, El Cóndor y La Rumorosa, con financiamiento directo y un equipo listo para acompañarte en cada paso hacia tu futuro y el de tu familia.',
  hero_image: '/assets/9ecfe82bd0a6ec0a6c3acc09741e7fd1.jpg',
  hero_caption: 'Equipo listo, justo cuando lo necesites',
  about_title: 'Construimos ideas que se convierten en realidad.',
  about_text_1: 'CONNOR Constructora del Noroeste es una empresa constructora y desarrolladora inmobiliaria con sede en Tecate, Baja California. Adquirimos terrenos, desarrollamos y urbanizamos fraccionamientos y comercializamos lotes residenciales y terrenos de inversión.',
  about_text_2: 'Combinamos conocimiento del mercado regional, planeación y ejecución en obra para que cada familia e inversionista construya patrimonio con certeza, en una región con vocación binacional.',
  mission: '',
  vision: '',
  philosophy: '',
  developments_intro: 'Seis fraccionamientos entre Tecate, El Cóndor y La Rumorosa, con enganches accesibles y mensualidades a tu alcance.',
  financing_down_payment: '$2,700',
  financing_down_payment_text: 'Enganches desde $2,700 MXN, según el desarrollo.',
  financing_max_payments: 'Hasta 90',
  privacy_notice: '',
  bot_enabled: '1',
  bot_instructions: '',
};

const DEVELOPMENTS = [
  {
    slug: 'vista-bonita', map_label: 'Nido de las Águilas, Tecate', number: 1, name: 'Vista Bonita', zone: 'Tecate',
    location: 'Col. Nido de las Águilas, Tecate, B.C. 21496',
    badge: 'PREVENTA', status: 'preventa', currency: 'MXN',
    cover_image: '/assets/2912605a1b331176cd4cc53074684516.jpg',
    cover_alt: 'Fraccionamiento Vista Bonita en obra, al pie del cerro',
    stats: [
      { label: 'LOTE', value: '140 m²', detail: '' },
      { label: 'ENGANCHE DESDE', value: '$8,000 MXN', detail: '' },
      { label: 'MENSUALIDADES', value: '90 × $3,000 MXN', detail: '' },
    ],
    total_price: '$278,000 MXN',
    features: ['Nuevo fraccionamiento', 'Gran potencial de crecimiento'],
  },
  {
    slug: 'hacienda-flor-de-mayo', map_label: 'ubicación por confirmar', number: 2, name: 'Hacienda Flor de Mayo', zone: null,
    location: 'Donde florecen los sueños',
    badge: null, status: 'venta', currency: 'MXN',
    cover_image: '/assets/0abf07dd6350136a240e3c1f268fdad0.jpg',
    cover_alt: 'Vista aérea del trazo de Hacienda Flor de Mayo',
    stats: [
      { label: 'LOTES', value: '120 – 140 m²', detail: '6×20 · 7×20 · 8×17 m' },
      { label: 'ENGANCHE', value: '$45,000 MXN', detail: '' },
      { label: 'MENSUALIDADES', value: '85 × $9,000 MXN', detail: '' },
    ],
    total_price: null,
    features: ['Agua potable', 'Electrificación aérea', 'Pavimento de concreto hidráulico (progresivo)', 'Telefonía e internet (progresivo)', 'Drenaje sanitario (progresivo)'],
  },
  {
    slug: 'san-sebastian-san-joaquin', map_label: 'Lomitas del Cuchumá, Tecate', number: 3, name: 'San Sebastián · Sección San Joaquín', zone: 'Tecate',
    location: 'Lomitas del Cuchumá, frente a la Iglesia Nazareno e Isstecali, Tecate',
    badge: null, status: 'venta', currency: 'USD',
    cover_image: '/assets/da66b1f1650193d2b0ff6e554dd53965.jpg',
    cover_alt: 'Panorama de Tecate y el cerro Cuchumá',
    stats: [
      { label: 'LOTES DESDE', value: '150 m²', detail: '' },
      { label: 'ENGANCHE', value: '$7,100 USD', detail: '' },
      { label: 'MENSUALIDADES', value: '84 × $764 USD', detail: '' },
    ],
    total_price: '$71,250 USD',
    features: ['Escrituración por título de propiedad', 'Sin bancos ni revisión de buró', 'Acceso controlado', 'Energía eléctrica'],
  },
  {
    slug: 'los-pinos', map_label: 'El Cóndor', number: 4, name: 'Los Pinos', zone: 'El Cóndor',
    location: 'El Cóndor, Baja California · Vive rodeado de naturaleza',
    badge: null, status: 'venta', currency: 'MXN',
    cover_image: '/assets/2ee5b2b5ebce7ec272368ea8e63b0ab2.jpg',
    cover_alt: 'Vista aérea de terrenos arbolados en El Cóndor',
    stats: [
      { label: 'TERRENO', value: '600 m²', detail: '20 × 30 m' },
      { label: 'ENGANCHE DESDE', value: '$45,000 MXN', detail: '' },
      { label: 'MENSUALIDADES', value: '$5,400 MXN', detail: 'Hasta 75 mensualidades' },
    ],
    total_price: null,
    features: ['Sin bancos ni revisión de buró', 'Acceso controlado', 'Vista al lago', 'Calles amplias', 'Luz eléctrica (progresivo)'],
  },
  {
    slug: 'villas-del-pedregal', map_label: 'La Rumorosa', number: 5, name: 'Villas del Pedregal', zone: 'La Rumorosa',
    location: 'La Rumorosa, a un costado de Albercas El Chaparral · a minutos del acceso principal',
    badge: null, status: 'venta', currency: 'MXN',
    cover_image: '/assets/775031c9a9af1a7079d06b3a5a224cea.jpg',
    cover_alt: 'Vista aérea de la lotificación de Villas del Pedregal',
    stats: [
      { label: 'LOTES', value: '200 y 250 m²', detail: '10×20 · 10×25 m' },
      { label: 'ENGANCHE DESDE', value: '$36,000 MXN', detail: '' },
      { label: 'PAGOS DESDE', value: '$4,250 MXN', detail: 'Hasta 48 mensualidades' },
    ],
    total_price: '$240,000 MXN',
    features: ['Sin bancos ni revisión de buró', 'Acceso controlado', 'Sendero de hiking y bicicleta', 'Casa club con alberca', 'Área de niños', 'Pérgolas y asadores'],
  },
  {
    slug: 'valle-del-borrego', map_label: 'La Rumorosa', number: 6, name: 'Valle del Borrego', zone: 'La Rumorosa',
    location: 'Entrada por las letras de La Rumorosa, junto a bomberos · a 5 min de la calle principal',
    badge: 'SIN INTERESES', status: 'venta', currency: 'MXN',
    cover_image: '/assets/5fb60e241086f8407031f82957b9b223.jpg',
    cover_alt: 'Vista aérea de Valle del Borrego con sus vialidades trazadas',
    stats: [
      { label: 'LOTE', value: '250 m²', detail: '10 × 25 m' },
      { label: 'ENGANCHE', value: '$2,700 MXN', detail: '' },
      { label: 'MENSUALIDADES', value: '85 × $2,700 MXN', detail: '' },
    ],
    total_price: '$232,200 MXN',
    features: ['Luz eléctrica', 'Acceso vehicular controlado', 'Cerco perimetral', 'Áreas recreativas con asadores', 'Zona para niños'],
  },
];

export async function seed({ log = console.log } = {}) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
  for (const d of DEVELOPMENTS) {
    const res = await pool.query(
      `INSERT INTO developments (slug, number, name, zone, location, map_label, badge, status, currency, cover_image, cover_alt, stats, total_price, features, sort_order)
       VALUES ($1,$2::smallint,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$2::int)
       ON CONFLICT (slug) DO NOTHING`,
      [d.slug, d.number, d.name, d.zone, d.location, d.map_label, d.badge, d.status, d.currency, d.cover_image, d.cover_alt,
        JSON.stringify(d.stats), d.total_price, d.features],
    );
    if (res.rowCount) log(`desarrollo cargado: ${d.name}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed().then(() => pool.end(), (err) => { console.error(err); process.exit(1); });
}
