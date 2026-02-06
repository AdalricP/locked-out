#!/usr/bin/env python3
"""
Create simple shield icons for the Focus Shield extension.
Uses PIL/Pillow to generate icons at different sizes.
"""

from PIL import Image, ImageDraw
import os

def create_shield_icon(size):
    """Create a shield icon with checkmark."""
    # Create image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Colors
    primary_color = (35, 131, 226)  # Blue
    bg_color = (247, 246, 243)      # Light gray

    # Calculate dimensions
    padding = size // 8
    shield_size = size - (2 * padding)

    # Draw shield background
    shield_points = []
    top_y = padding
    bottom_y = size - padding
    mid_x = size // 2
    width = shield_size

    # Top left
    shield_points.append((mid_x - width // 2, top_y))
    # Top right
    shield_points.append((mid_x + width // 2, top_y))
    # Right curve
    for i in range(10):
        y = top_y + (bottom_y - top_y) * (i / 10) * 0.8
        x = mid_x + (width // 2) * (1 - (i / 20))
        shield_points.append((x, y))
    # Bottom point
    shield_points.append((mid_x, bottom_y))
    # Left curve
    for i in range(10):
        y = bottom_y - (bottom_y - top_y) * (i / 10) * 0.8
        x = mid_x - (width // 2) * (1 - (i / 20))
        shield_points.append((x, y))

    # Draw simplified shield (polygon)
    shield_outline = [
        (mid_x - width // 2 + 2, top_y + 2),
        (mid_x + width // 2 - 2, top_y + 2),
        (mid_x + width // 2 - 2, top_y + shield_size * 0.6),
        (mid_x, bottom_y - 2),
        (mid_x - width // 2 + 2, top_y + shield_size * 0.6),
    ]

    draw.polygon(shield_outline, fill=primary_color)

    # Draw checkmark
    check_padding = size // 4
    check_size = size - (2 * check_padding)

    # Checkmark coordinates
    check_start = (mid_x - check_size // 4, mid_x)
    check_middle = (mid_x - check_size // 10, mid_x + check_size // 4)
    check_end = (mid_x + check_size // 3, mid_x - check_size // 6)

    # Draw checkmark with thick lines
    draw.line([check_start, check_middle], fill='white', width=max(2, size // 16))
    draw.line([check_middle, check_end], fill='white', width=max(2, size // 16))

    return img

def create_all_icons():
    """Create icons at all required sizes."""
    sizes = [16, 48, 128]
    script_dir = os.path.dirname(os.path.abspath(__file__))

    for size in sizes:
        icon = create_shield_icon(size)
        filename = os.path.join(script_dir, f'icon{size}.png')
        icon.save(filename, 'PNG')
        print(f'Created {filename}')

if __name__ == '__main__':
    create_all_icons()
