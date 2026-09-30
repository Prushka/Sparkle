package encode

import (
	_ "embed"
	"os"
	"path/filepath"
)

//go:embed ai_hdr_natural.glsl
var naturalHDRShader []byte

// The executable owns the shader revision. A job gets a private, bounded copy
// next to its compressed intermediates; it is never part of the media cache.
func writeNaturalHDRShader(dir string) (func(), error) {
	path := filepath.Join(dir, "hdr-natural.glsl")
	if err := os.WriteFile(path, naturalHDRShader, 0600); err != nil {
		return nil, err
	}
	return func() { _ = os.Remove(path) }, nil
}
