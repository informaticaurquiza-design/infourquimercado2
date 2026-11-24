import type { CategoryId } from '../types/ecommerce';

export const ASSET_IMAGES = {
  hero: '/src/assets/images/hero_alba_showcase_1795360460440.jpg',
  heroTech: '/src/assets/images/hero_tech_workspace_1795549487196.jpg',
  heroHome: '/src/assets/images/hero_home_living_1795549486647.jpg',
  heroLifestyle: '/src/assets/images/hero_lifestyle_gear_1795549487385.jpg',
  tecnologia: '/src/assets/images/prod_audio_headphones_1795360459663.jpg',
  hogar: '/src/assets/images/prod_home_lamp_1795360459279.jpg',
  indumentaria: '/src/assets/images/prod_apparel_jacket_1795360458908.jpg',
  relojeria: '/src/assets/images/prod_watch_chrono_1795360458910.jpg',
  deportes: '/src/assets/images/prod_outdoor_pack_1795360459404.jpg',
  gourmet: '/src/assets/images/prod_gourmet_coffee_1795360459166.jpg',
} as const;

export interface HeroBannerSlide {
  id: string;
  src: string;
  alt: string;
  caption: string;
}

export const HERO_BANNER_SLIDES: HeroBannerSlide[] = [
  {
    id: 'showcase',
    src: ASSET_IMAGES.hero,
    alt: 'Selección destacada de productos de Infourqui Mercado',
    caption: 'Colección destacada',
  },
  {
    id: 'tech-workspace',
    src: ASSET_IMAGES.heroTech,
    alt: 'Espacio de trabajo minimalista con teclado mecánico, parlante y auriculares',
    caption: 'Tecnología & Audio',
  },
  {
    id: 'home-living',
    src: ASSET_IMAGES.heroHome,
    alt: 'Iluminación arquitectónica y objetos contemporáneos para el hogar',
    caption: 'Hogar & Diseño',
  },
  {
    id: 'lifestyle-gear',
    src: ASSET_IMAGES.heroLifestyle,
    alt: 'Selección curada de relojería, mochila técnica, campera y pava barista',
    caption: 'Selección curada',
  },
  {
    id: 'audio-headphones',
    src: ASSET_IMAGES.tecnologia,
    alt: 'Auriculares de estudio con acabado premium',
    caption: 'Audio de estudio',
  },
  {
    id: 'home-lamp',
    src: ASSET_IMAGES.hogar,
    alt: 'Lámpara de mesa de diseño arquitectónico',
    caption: 'Iluminación de diseño',
  },
  {
    id: 'urban-jacket',
    src: ASSET_IMAGES.indumentaria,
    alt: 'Campera técnica impermeable de indumentaria urbana',
    caption: 'Indumentaria Urbana',
  },
  {
    id: 'chrono-watch',
    src: ASSET_IMAGES.relojeria,
    alt: 'Cronógrafo automático de acero cepillado',
    caption: 'Relojería & Accesorios',
  },
  {
    id: 'outdoor-pack',
    src: ASSET_IMAGES.deportes,
    alt: 'Mochila técnica impermeable para ciudad y outdoor',
    caption: 'Deportes & Outdoor',
  },
  {
    id: 'gourmet-coffee',
    src: ASSET_IMAGES.gourmet,
    alt: 'Pava cuello de cisne y equipamiento para café de especialidad',
    caption: 'Café & Gourmet',
  },
];

export function getDefaultCategoryImage(category: CategoryId): string {
  return ASSET_IMAGES[category] ?? ASSET_IMAGES.tecnologia;
}
