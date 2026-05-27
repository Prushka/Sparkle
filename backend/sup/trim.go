package sup

import (
	"image"
)

// isRowTransparent checks if a given horizontal row in an image is entirely transparent.
func isRowTransparent(img image.Image, y int) bool {
	bounds := img.Bounds()
	for x := bounds.Min.X; x < bounds.Max.X; x++ {
		_, _, _, a := img.At(x, y).RGBA()
		if a != 0 {
			return false
		}
	}
	return true
}

// isColumnTransparent checks if a given vertical column in an image is entirely transparent.
func isColumnTransparent(img image.Image, x int) bool {
	bounds := img.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		_, _, _, a := img.At(x, y).RGBA()
		if a != 0 {
			return false
		}
	}
	return true
}

// TrimTransparentRows trims consecutive fully transparent horizontal lines in an image.
// If more than 10 consecutive transparent lines are found, they are trimmed down to 10.
func TrimTransparentRows(img image.Image) image.Image {
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// 1. Identify all transparent rows
	transparentRows := make([]bool, height)
	for y := 0; y < height; y++ {
		transparentRows[y] = isRowTransparent(img, bounds.Min.Y+y)
	}

	// 2. Determine the height of the new image
	newHeight := 0
	consecutiveTransparentCount := 0
	for _, isTransparent := range transparentRows {
		if isTransparent {
			consecutiveTransparentCount++
		} else {
			consecutiveTransparentCount = 0
		}

		if consecutiveTransparentCount <= 10 {
			newHeight++
		}
	}

	// If the height hasn't changed, return the original image
	if newHeight == height {
		return img
	}

	// 3. Create a new image with the calculated height
	newImg := image.NewRGBA(image.Rect(0, 0, width, newHeight))

	// 4. Copy the relevant rows to the new image
	destY := 0
	consecutiveTransparentCount = 0
	for y := 0; y < height; y++ {
		isTransparent := transparentRows[y]
		if isTransparent {
			consecutiveTransparentCount++
		} else {
			consecutiveTransparentCount = 0
		}

		if consecutiveTransparentCount <= 10 {
			// Copy the row
			for x := 0; x < width; x++ {
				newImg.Set(x, destY, img.At(bounds.Min.X+x, bounds.Min.Y+y))
			}
			destY++
		}
	}

	return newImg
}

// TrimTransparentColumns trims transparent columns from the left and right edges.
// If the transparent margin is > 10 pixels, it's trimmed down to 10.
// The trimming stops once a non-transparent column is found from either side.
func TrimTransparentColumns(img image.Image) image.Image {
	bounds := img.Bounds()
	minX, minY := bounds.Min.X, bounds.Min.Y
	maxX, maxY := bounds.Max.X, bounds.Max.Y

	// Find the first non-transparent column from the left
	firstNonTransparentX := minX
	for x := minX; x < maxX; x++ {
		if !isColumnTransparent(img, x) {
			firstNonTransparentX = x
			break
		}
		// If the loop finishes, the entire image is transparent.
		// In that case, we'll handle it as a full-width transparent image.
		if x == maxX-1 {
			firstNonTransparentX = maxX
		}
	}

	// Find the first non-transparent column from the right
	lastNonTransparentX := maxX
	for x := maxX - 1; x >= minX; x-- {
		if !isColumnTransparent(img, x) {
			lastNonTransparentX = x + 1 // +1 because bounds are exclusive on the max side
			break
		}
		// If the loop finishes, the image is fully transparent.
		if x == minX {
			lastNonTransparentX = minX
		}
	}

	// Calculate the number of transparent columns on each side
	leftTransparentCount := firstNonTransparentX - minX
	rightTransparentCount := maxX - lastNonTransparentX

	// Determine the new start X, keeping up to 10 transparent columns
	newMinX := minX
	if leftTransparentCount > 10 {
		newMinX = firstNonTransparentX - 10
	}

	// Determine the new end X, keeping up to 10 transparent columns
	newMaxX := maxX
	if rightTransparentCount > 10 {
		newMaxX = lastNonTransparentX + 10
	}

	// Handle the case of an entirely transparent image to avoid incorrect bounds
	if newMinX >= newMaxX {
		if maxX-minX > 20 {
			newMinX = minX
			newMaxX = minX + 20 // If fully transparent, trim to 20px wide
		} else {
			return img // Or return original if it's already small
		}
	}

	// If the bounds haven't changed, return the original image
	if newMinX == minX && newMaxX == maxX {
		return img
	}

	// Create a new sub-image with the calculated horizontal bounds
	// This is efficient as it doesn't copy pixel data.
	// We need to check if the image type supports SubImage.
	if sub, ok := img.(interface {
		SubImage(r image.Rectangle) image.Image
	}); ok {
		return sub.SubImage(image.Rect(newMinX, minY, newMaxX, maxY))
	}

	// Fallback for image types that don't support SubImage: create a new image and copy data.
	newWidth := newMaxX - newMinX
	newHeight := maxY - minY
	newImg := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	for y := 0; y < newHeight; y++ {
		for x := 0; x < newWidth; x++ {
			newImg.Set(x, y, img.At(newMinX+x, minY+y))
		}
	}
	return newImg
}
