// Package sentinel provides sentinel values used accross multiple other
// packages. This prevents unwanted direct package dependencies.
package sentinel

import "errors"

var (
	// ErrNotFound indicates something was not found
	ErrNotFound = errors.New("NotFound")

	// ErrForbidden indicates something was forbidden
	ErrForbidden = errors.New("Forbidden")
)
