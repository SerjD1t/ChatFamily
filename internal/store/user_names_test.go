package store

import (
	"strings"
	"testing"
)

func TestNormalizeUserNames(t *testing.T) {
	first, last, err := NormalizeUserNames(" Анна ", " Петрова ")
	if err != nil || first != "Анна" || last != "Петрова" {
		t.Fatal("normalization")
	}
	if _, last, err = NormalizeUserNames("Анна", ""); err != nil || last != "" {
		t.Fatal("optional surname")
	}
	for _, pair := range [][2]string{{"", "Last"}, {"Name", strings.Repeat("я", 121)}, {"A\nB", "Last"}} {
		if _, _, err = NormalizeUserNames(pair[0], pair[1]); err == nil {
			t.Fatal("invalid name accepted")
		}
	}
}
