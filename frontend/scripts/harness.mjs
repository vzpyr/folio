let passed = 0;
let failed = 0;

export function check(label, ok, extra = "") {
  if (ok) {
    passed += 1;
    console.log(`pass: ${label}`);
  } else {
    failed += 1;
    console.log(`fail: ${label}${extra ? ` - ${extra}` : ""}`);
  }
}

export function done(name) {
  console.log(`\n${name}: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
