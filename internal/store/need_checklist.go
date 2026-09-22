package store

import (
	"familychat/internal/chat"
	"strings"
)

// Replacement is an editor operation; checking an existing entry is a member operation.
// The caller holds the item lock and has checked scope and editor permissions.
func applyChecklist(n *chat.ShoppingItem, in NeedInput, creating bool) error {
	changing := in.Checklist != nil || in.CheckItem != nil
	if in.ChecklistSource != nil && (in.Checklist == nil || len([]rune(*in.ChecklistSource)) > 4000) {
		return chat.ErrInvalid
	}
	if changing && (n.Kind != "purchase" || n.ArchivedAt != nil || (!creating && in.Version == nil)) {
		return chat.ErrInvalid
	}
	if in.Checklist != nil && in.CheckItem != nil {
		return chat.ErrInvalid
	}
	if in.Checklist != nil {
		if len(*in.Checklist) > 100 {
			return chat.ErrInvalid
		}
		previous := map[string]bool{}
		for _, entry := range n.Checklist {
			previous[entry.ID] = true
		}
		seen := map[string]bool{}
		result := make([]chat.ChecklistItem, 0, len(*in.Checklist))
		for _, entry := range *in.Checklist {
			entry.Text = strings.TrimSpace(entry.Text)
			if entry.Text == "" || len([]rune(entry.Text)) > 160 {
				return chat.ErrInvalid
			}
			if entry.ID == "" {
				entry.ID = id()
			} else if !previous[entry.ID] {
				return chat.ErrInvalid
			}
			if seen[entry.ID] {
				return chat.ErrInvalid
			}
			seen[entry.ID] = true
			result = append(result, entry)
		}
		n.Checklist = result
	}
	if in.CheckItem != nil {
		if creating || n.CompletedAt != nil || in.CheckItem.Text != "" {
			return chat.ErrInvalid
		}
		found := false
		for i := range n.Checklist {
			if n.Checklist[i].ID == in.CheckItem.ID {
				n.Checklist[i].Completed = in.CheckItem.Completed
				found = true
				break
			}
		}
		if !found {
			return chat.ErrInvalid
		}
	}
	// Prevent an old client switching a purchase with a checklist into a task invisibly.
	if n.Kind != "purchase" && len(n.Checklist) > 0 {
		return chat.ErrInvalid
	}
	return nil
}
