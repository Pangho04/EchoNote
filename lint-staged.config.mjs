export default {
  '*.{js,mjs,cjs,ts,tsx}': ['prettier --write', 'eslint --fix'],
  '*.{json,md,yaml,yml,css}': ['prettier --write'],
};
