package catalog

import (
	"net/http/httptest"
	"testing"
)

func TestArtworkBrowserFreshnessAndRevalidation(t *testing.T) {
	_, mux, _, id := fixture(t)
	for _, kind := range []string{"poster", "backdrop"} {
		path := "/media/" + id + "/artwork/" + kind
		first := httptest.NewRecorder()
		mux.ServeHTTP(first, httptest.NewRequest("GET", path, nil))
		if first.Code != 200 || first.Header().Get("Cache-Control") != "private, max-age=300" {
			t.Fatalf("artwork cannot be reused locally: %d %v", first.Code, first.Header())
		}
		etag := first.Header().Get("ETag")
		if etag == "" {
			t.Fatal("missing artwork validator")
		}
		for _, method := range []string{"GET", "HEAD"} {
			request := httptest.NewRequest(method, path, nil)
			request.Header.Set("If-None-Match", etag)
			revalidated := httptest.NewRecorder()
			mux.ServeHTTP(revalidated, request)
			if revalidated.Code != 304 || revalidated.Body.Len() != 0 || revalidated.Header().Get("ETag") != etag || revalidated.Header().Get("Cache-Control") != first.Header().Get("Cache-Control") {
				t.Fatalf("%s revalidation failed: %d %v", method, revalidated.Code, revalidated.Header())
			}
		}
	}
}
