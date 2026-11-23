import type { CategoryId } from '../types/ecommerce';

export const ASSET_IMAGES = {
  hero: '/src/assets/images/hero_alba_showcase_1795360460440.jpg',
  tecnologia: '/src/assets/images/prod_audio_headphones_1795360459663.jpg',
  hogar: '/src/assets/images/prod_home_lamp_1795360459279.jpg',
  indumentaria: '/src/assets/images/prod_apparel_jacket_1795360458908.jpg',
  relojeria: '/src/assets/images/prod_watch_chrono_1795360458910.jpg',
  deportes: '/src/assets/images/prod_outdoor_pack_1795360459404.jpg',
  gourmet: '/src/assets/images/prod_gourmet_coffee_1795360459166.jpg',
} as const;

export function getDefaultCategoryImage(category: CategoryId): string {
  return ASSET_IMAGES[category] ?? ASSET_IMAGES.tecnologia;
}
