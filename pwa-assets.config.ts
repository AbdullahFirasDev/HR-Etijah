import { createAppleSplashScreens, defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Regenerate icons + iOS splash screens with: npm run pwa:assets
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    appleSplashScreens: createAppleSplashScreens({
      padding: 0.35,
      resizeOptions: { background: '#ffffff', fit: 'contain' },
      linkMediaOptions: { log: true, addMediaScreen: true, basePath: '/icons/', xhtml: false },
      png: { compressionLevel: 9, quality: 70 },
      name: (landscape, size, dark) => `apple-splash-${landscape ? 'landscape' : 'portrait'}-${dark ? 'dark-' : ''}${size.width}x${size.height}.png`,
    }, ['iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 14', 'iPhone 13 mini', 'iPhone SE 4.7"', 'iPad Air 10.9"', 'iPad Pro 12.9"']),
  },
  images: ['public/icons/icon.svg'],
})
