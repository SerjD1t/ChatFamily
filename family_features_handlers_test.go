package main

import "testing"

func TestParseShoppingDate(t *testing.T) {
	date, err := parseShoppingDate("2026-08-22")
	if err != nil || date.Format("2006-01-02") != "2026-08-22" {
		t.Fatalf("unexpected parsed date: %v, %v", date, err)
	}
	if _, err := parseShoppingDate(""); err == nil {
		t.Fatal("empty date must be rejected")
	}
	if _, err := parseShoppingDate("22.08.2026"); err == nil {
		t.Fatal("non-ISO date must be rejected")
	}
}
