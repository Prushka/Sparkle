// Sparkle's bounded highlight grade. Input/output: display-referred BT.2020 PQ.
// Every statistic belongs to this frame. No peak stretching, temporal state,
// local sharpening, or neighboring-pixel correction of the output image.

//!HOOK MAIN
//!BIND HOOKED
//!SAVE SPARKLE_STATS
//!WIDTH 32
//!HEIGHT 18
//!DESC Sparkle bounded highlight coverage

#define SDR 0

vec3 nits(vec3 v) {
    vec3 p = pow(max(v, vec3(0.0)), vec3(1.0 / 78.84375));
    return 10000.0 * pow(max(p - 0.8359375, vec3(0.0)) /
        max(18.8515625 - 18.6875 * p, vec3(1e-6)), vec3(1.0 / 0.1593017578125));
}

vec4 hook() {
    // Stratified samples avoid a single pixel (stars, noise, a subtitle edge)
    // becoming a frame peak. Black bars contribute neither weight nor light.
    float weightSum = 0.0, bright = 0.0;
    for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
        vec2 pos = HOOKED_pos + (vec2(x, y) - 0.5) / vec2(64.0, 36.0);
        float l = dot(nits(HOOKED_tex(pos).rgb), vec3(0.2627, 0.6780, 0.0593));
        float weight = smoothstep(0.01, 0.1, l);
        bright += weight * smoothstep(SDR != 0 ? 100.0 : 203.0, SDR != 0 ? 203.0 : 600.0, l);
        weightSum += weight;
    }
    return vec4(bright, weightSum, 0.0, 1.0) / 4.0;
}

//!HOOK MAIN
//!BIND SPARKLE_STATS
//!SAVE SPARKLE_COVERAGE
//!WIDTH 1
//!HEIGHT 1
//!DESC Sparkle frame coverage reduction

vec4 hook() {
    vec2 sum = vec2(0.0);
    for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) {
        sum += SPARKLE_STATS_tex((vec2(x, y) + 0.5) / vec2(32.0, 18.0)).rg;
    }
    return vec4(sum.x / max(sum.y, 1.0), 0.0, 0.0, 1.0);
}

//!HOOK MAIN
//!BIND HOOKED
//!BIND SPARKLE_COVERAGE
//!DESC Sparkle anchored highlight curve

#define SDR 0

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
    float coverage = clamp(SPARKLE_COVERAGE_tex(vec2(0.5)).r, 0.0, 1.0);
    // HDR <=203 nits and SDR <=100 nits (after a fixed 203-nit reference
    // conversion) are invariant. Broad highlights get less enhancement than
    // small ones. Coverage can change gain by at most 0.10, never exposure.
    float strength = (SDR != 0 ? 0.30 : 0.25) - 0.10 * coverage;
    rgb *= 1.0 + strength * smoothstep(SDR != 0 ? 100.0 : 203.0, SDR != 0 ? 203.0 : 600.0, l);
    // Hue-preserving RGB scaling with a C2 shoulder: identity up to 1000 nits,
    // approaching 1600 smoothly. It bounds every primary, not only luminance.
    float peak = max(rgb.r, max(rgb.g, rgb.b));
    float excess = max(peak - 1000.0, 0.0);
    float rolled = 1000.0 + excess / sqrt(1.0 + (excess / 600.0) * (excess / 600.0));
    if (peak > 1000.0) rgb *= rolled / peak;
    return vec4(pq(rgb), color.a);
}
