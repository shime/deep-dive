module.exports = {
  content: ["./_site/**/*.html"],
  css: ["./_site/css/style.css"],
  defaultExtractor: content => content.match(/[A-Za-z0-9-_:/]+/g) || [],
  whitelist: ["medium-zoom-overlay", "anchorjs-link"],
};
