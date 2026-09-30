// Sparkle's content-adaptive HDR grade. Input/output: absolute BT.2020 PQ.
// A robust image key drives bounded exposure, not peak-to-peak stretching.
// Frame-local statistics give identical grading after independent segment seeks.

//!HOOK MAIN
//!BIND HOOKED
//!SAVE SPARKLE_STATS
//!WIDTH 32
//!HEIGHT 18
//!DESC Sparkle robust image key and highlight coverage

vec3 nits(vec3 v) {
    vec3 p = pow(max(v, vec3(0.0)), vec3(1.0 / 78.84375));
    return 10000.0 * pow(max(p - 0.8359375, vec3(0.0)) /
        max(18.8515625 - 18.6875 * p, vec3(1e-6)), vec3(1.0 / 0.1593017578125));
}

vec4 hook() {
    // Stratified samples avoid a single pixel (stars, noise, a subtitle edge)
    // becoming a frame peak. Black bars contribute neither weight nor light.
    float weightSum = 0.0, bright = 0.0, key = 0.0;
    for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
        vec2 pos = HOOKED_pos + (vec2(x, y) - 0.5) / vec2(64.0, 36.0);
        float l = dot(nits(HOOKED_tex(pos).rgb), vec3(0.2627, 0.6780, 0.0593));
        float weight = smoothstep(0.01, 0.1, l);
        // Winsorize the log mean at diffuse white: a tiny specular flash
        // must not dim all the other objects in the image.
        key += weight * log2(1.0 + min(l, 203.0));
        bright += weight * smoothstep(203.0, 1000.0, l);
        weightSum += weight;
    }
    return vec4(key, bright, weightSum, 1.0) / 4.0;
}

//!HOOK MAIN
//!BIND SPARKLE_STATS
//!SAVE SPARKLE_EXPOSURE
//!WIDTH 1
//!HEIGHT 1
//!DESC Sparkle bounded content adaptation

vec4 hook() {
    vec3 sum = vec3(0.0);
    for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) {
        sum += SPARKLE_STATS_tex((vec2(x, y) + 0.5) / vec2(32.0, 18.0)).rgb;
    }
    float key = sum.x / max(sum.z, 1.0);
    float coverage = clamp(sum.y / max(sum.z, 1.0), 0.0, 1.0);
    // Modest adaptation of overall brightness (1.6-2.2x), with a continuous
    // fade-to-black guard. Never expose a black/night scene as daylight.
    float adaptation = smoothstep(log2(6.0), log2(151.0), key);
    float fade = smoothstep(0.0, log2(6.0), key);
    float exposure = 1.0 + fade * mix(1.2, 0.6, adaptation);
    // Broad bright areas need less additional highlight gain than small ones.
    return vec4(exposure, mix(0.70, 0.45, coverage), 0.0, 1.0);
}

//!HOOK MAIN
//!BIND HOOKED
//!BIND SPARKLE_EXPOSURE
//!DESC Sparkle smooth exposure and highlight shoulder

vec3 nits(vec3 v) {
    vec3 p = pow(max(v, vec3(0.0)), vec3(1.0 / 78.84375));
    return 10000.0 * pow(max(p - 0.8359375, vec3(0.0)) /
        max(18.8515625 - 18.6875 * p, vec3(1e-6)), vec3(1.0 / 0.1593017578125));
}

vec3 pq(vec3 v) {
    vec3 p = pow(max(v, vec3(0.0)) / 10000.0, vec3(0.1593017578125));
    return pow((0.8359375 + 18.8515625 * p) / (1.0 + 18.6875 * p), vec3(78.84375));
}

vec4 hook() {
    vec4 color = HOOKED_texOff(0);
    vec3 rgb = nits(color.rgb);
    float l = dot(rgb, vec3(0.2627, 0.6780, 0.0593));
    vec2 controls = SPARKLE_EXPOSURE_tex(vec2(0.5)).rg;
    // Protect near-black, then lift midtones before adding highlight contrast.
    // Log-domain transitions spread the change across perceptual brightness.
    float toe = smoothstep(log2(1.1), log2(6.0), log2(1.0 + l));
    float highlight = smoothstep(log2(101.0), log2(601.0), log2(1.0 + l));
    float gain = mix(1.0, controls.x, toe) * (1.0 + controls.y * highlight);
    rgb *= gain;
    // Hue-preserving RGB scaling with a C2 shoulder: identity up to 800 nits,
    // approaching 1600 smoothly. It bounds every primary, not only luminance.
    float peak = max(rgb.r, max(rgb.g, rgb.b));
    float excess = max(peak - 800.0, 0.0);
    float rolled = 800.0 + excess / sqrt(1.0 + (excess / 800.0) * (excess / 800.0));
    if (peak > 800.0) rgb *= rolled / peak;
    return vec4(pq(rgb), color.a);
}
