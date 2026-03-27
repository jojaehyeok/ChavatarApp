module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }], // v4 기준
      "nativewind/babel",
    ],
    plugins: [
      // 만약 Reanimated 같은 걸 쓰신다면 여기에 추가
    ],
  };
};