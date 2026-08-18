package store

import (
	"testing"

	"familychat/internal/chat"
)

func TestNormalizeFamilyCategoriesAllowsUnclassifiedMember(t *testing.T) {
	categories, err := normalizeFamilyCategories([]chat.FamilyCategory{})
	if err != nil {
		t.Fatalf("empty categories must be allowed: %v", err)
	}
	if len(categories) != 0 {
		t.Fatalf("got %v, want no categories", categories)
	}
}

func TestNormalizeFamilyCategoriesRejectsUnknownCategory(t *testing.T) {
	if _, err := normalizeFamilyCategories([]chat.FamilyCategory{"unknown"}); err == nil {
		t.Fatal("unknown category must be rejected")
	}
}
