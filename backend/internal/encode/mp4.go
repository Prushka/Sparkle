package encode

import (
	"encoding/binary"
	"io"
	"math"
	"os"
)

type box struct {
	kind                string
	start, size, header int64
}

func boxes(f io.ReaderAt, start, end int64) ([]box, error) {
	result := []box{}
	for start < end {
		var header [16]byte
		if end-start < 8 {
			return nil, errEncode
		}
		if _, err := f.ReadAt(header[:8], start); err != nil {
			return nil, errEncode
		}
		size, h := int64(binary.BigEndian.Uint32(header[:4])), int64(8)
		if size == 1 {
			if _, err := f.ReadAt(header[8:], start+8); err != nil {
				return nil, errEncode
			}
			size = int64(binary.BigEndian.Uint64(header[8:]))
			h = 16
		}
		if size == 0 {
			size = end - start
		}
		if size < h || size > end-start || len(result) > 16384 {
			return nil, errEncode
		}
		result = append(result, box{string(header[4:8]), start, size, h})
		start += size
	}
	return result, nil
}
func child(f io.ReaderAt, parent box, kind string) (box, error) {
	items, err := boxes(f, parent.start+parent.header, parent.start+parent.size)
	if err != nil {
		return box{}, err
	}
	for _, b := range items {
		if b.kind == kind {
			return b, nil
		}
	}
	return box{}, errEncode
}
func u32(f io.ReaderAt, at int64) (uint32, error) {
	var b [4]byte
	_, err := f.ReadAt(b[:], at)
	return binary.BigEndian.Uint32(b[:]), err
}
func version(f io.ReaderAt, b box) byte {
	var v [1]byte
	_, _ = f.ReadAt(v[:], b.start+b.header)
	return v[0]
}

// Independent NVENC invocations start their fragments at zero. Shift decode
// times onto one HLS timeline without touching codec payloads or HDR boxes.
func shiftFragments(name string, start float64) (int64, error) {
	f, err := os.OpenFile(name, os.O_RDWR, 0)
	if err != nil {
		return 0, errEncode
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return 0, errEncode
	}
	items, err := boxes(f, 0, info.Size())
	if err != nil {
		return 0, err
	}
	scales := map[uint32]uint32{}
	var init int64
	for _, b := range items {
		if b.kind == "moov" {
			tracks, e := boxes(f, b.start+b.header, b.start+b.size)
			if e != nil {
				return 0, e
			}
			for _, t := range tracks {
				if t.kind != "trak" {
					continue
				}
				tk, e := child(f, t, "tkhd")
				if e != nil {
					return 0, e
				}
				offset := int64(12)
				if version(f, tk) == 1 {
					offset = 20
				}
				id, e := u32(f, tk.start+tk.header+offset)
				if e != nil {
					return 0, e
				}
				md, e := child(f, t, "mdia")
				if e != nil {
					return 0, e
				}
				mh, e := child(f, md, "mdhd")
				if e != nil {
					return 0, e
				}
				offset = 12
				if version(f, mh) == 1 {
					offset = 20
				}
				scale, e := u32(f, mh.start+mh.header+offset)
				if e != nil || scale == 0 {
					return 0, errEncode
				}
				scales[id] = scale
			}
		}
		if b.kind != "moof" {
			continue
		}
		if init == 0 {
			init = b.start
		}
		trafs, e := boxes(f, b.start+b.header, b.start+b.size)
		if e != nil {
			return 0, e
		}
		for _, t := range trafs {
			if t.kind != "traf" {
				continue
			}
			tf, e := child(f, t, "tfhd")
			if e != nil {
				return 0, e
			}
			id, e := u32(f, tf.start+tf.header+4)
			if e != nil || scales[id] == 0 {
				return 0, errEncode
			}
			dt, e := child(f, t, "tfdt")
			if e != nil {
				return 0, e
			}
			at := dt.start + dt.header + 4
			shift := uint64(math.Round(start * float64(scales[id])))
			var data [8]byte
			if version(f, dt) == 1 {
				if _, e = f.ReadAt(data[:], at); e != nil {
					return 0, e
				}
				binary.BigEndian.PutUint64(data[:], binary.BigEndian.Uint64(data[:])+shift)
				_, e = f.WriteAt(data[:], at)
			} else {
				v, e := u32(f, at)
				if e != nil || uint64(v)+shift > math.MaxUint32 {
					return 0, errEncode
				}
				binary.BigEndian.PutUint32(data[:4], v+uint32(shift))
				_, e = f.WriteAt(data[:4], at)
			}
			if e != nil {
				return 0, e
			}
		}
	}
	if init == 0 || init > 4<<20 {
		return 0, errEncode
	}
	return init, nil
}
