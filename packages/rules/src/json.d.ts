declare module "*.json" {
  const value: import("./types.js").PlatformRuleMap;
  export default value;
}
