package plexauth

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestSessionStorageWindowsPermissions(t *testing.T) {
	dir := t.TempDir()
	setup(t, dir)
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{dir, filepath.Join(dir, "sessions.db")} {
		sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
		if err != nil {
			t.Fatal(err)
		}
		inherit := ""
		if path == dir {
			inherit = "OICI"
		}
		want := "D:P(A;" + inherit + ";FA;;;" + user.User.Sid.String() + ")(A;" + inherit + ";FA;;;SY)"
		// Windows may also mark a protected DACL as auto-inherited (AI).
		if strings.Replace(sd.String(), "D:PAI", "D:P", 1) != want {
			t.Fatalf("session ACL = %q, want backend account and Local System only", sd.String())
		}
	}
}
