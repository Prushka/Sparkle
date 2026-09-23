#include <stdio.h>
#include <stddef.h>
#include "libavutil/dovi_meta.h"
#define P(T,f) printf(#T "." #f "=%zu\n", offsetof(T,f));
#define S(T) printf(#T ".size=%zu\n", sizeof(T));
int main(){S(AVDOVIMetadata); S(AVDOVIRpuDataHeader);S(AVDOVIReshapingCurve);S(AVDOVIDataMapping);S(AVDOVIColorMetadata);
P(AVDOVIRpuDataHeader,coef_log2_denom);P(AVDOVIRpuDataHeader,bl_bit_depth);P(AVDOVIRpuDataHeader,disable_residual_flag);
P(AVDOVIDataMapping,curves);P(AVDOVIDataMapping,nlq_method_idc);
P(AVDOVIReshapingCurve,pivots);P(AVDOVIReshapingCurve,mapping_idc);P(AVDOVIReshapingCurve,poly_coef);P(AVDOVIReshapingCurve,mmr_order);P(AVDOVIReshapingCurve,mmr_constant);P(AVDOVIReshapingCurve,mmr_coef);
P(AVDOVIColorMetadata,ycc_to_rgb_matrix);P(AVDOVIColorMetadata,ycc_to_rgb_offset);P(AVDOVIColorMetadata,rgb_to_lms_matrix);
return 0;}
