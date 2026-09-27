package encode

import (
	"bytes"
	"encoding/binary"
	"io"
	"os"
)

// Add mastering metadata to our fragmented output's video sample description.
// Fragment offsets are relative to moof; changing moov cannot move their targets.
// Never copy source mastering/CLL values onto a newly expanded grade.
func writeHDRMastering(name string) error {
	in, err := os.Open(name)
	if err != nil {
		return errEncode
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return errEncode
	}
	moov, err := child(in, box{size: info.Size()}, "moov")
	if err != nil || moov.start+moov.size > 4<<20 {
		return errEncode
	}
	header := make([]byte, moov.start+moov.size)
	if _, err = io.ReadFull(in, header); err != nil {
		return errEncode
	}
	updated, count, err := hdrBoxes(header[moov.start:])
	if err != nil || count != 1 {
		return errEncode
	}
	out, err := os.Create(name + ".hdr")
	if err != nil {
		return errEncode
	}
	defer os.Remove(name + ".hdr")
	_, err = out.Write(append(header[:moov.start:moov.start], updated...))
	if err == nil {
		_, err = io.Copy(out, in)
	}
	closeErr := out.Close()
	in.Close()
	if err != nil || closeErr != nil {
		return errEncode
	}
	if err = os.Rename(name+".hdr", name); err != nil {
		return errEncode
	}
	return nil
}

func hdrBoxes(data []byte) ([]byte, int, error) {
	items, err := boxes(bytes.NewReader(data), 0, int64(len(data)))
	if err != nil {
		return nil, 0, err
	}
	var result []byte
	count := 0
	for _, b := range items {
		body := data[b.start+b.header : b.start+b.size]
		skip := -1
		switch b.kind {
		case "moov", "trak", "mdia", "minf", "stbl":
			skip = 0
		case "stsd":
			skip = 8
		case "hvc1", "hev1", "av01":
			skip = 78
		}
		if skip >= 0 {
			if len(body) < skip {
				return nil, 0, errEncode
			}
			children, n, err := hdrBoxes(body[skip:])
			if err != nil {
				return nil, 0, err
			}
			count += n
			if skip == 78 {
				// SMPTE ST 2086 uses G,B,R order, 0.00002 chromaticity and
				// 0.0001 nit luminance units. Rec.2020 / D65, 1600 / 0.005 nit.
				mdcv := make([]byte, 24)
				for i, v := range []uint16{8500, 39850, 6550, 2300, 35400, 14600, 15635, 16450} {
					binary.BigEndian.PutUint16(mdcv[i*2:], v)
				}
				binary.BigEndian.PutUint32(mdcv[16:], aiHDRPeak*10000)
				binary.BigEndian.PutUint32(mdcv[20:], 50)
				children = append(children, hdrBox("mdcv", mdcv)...)
				// MaxCLL is the processing ceiling; frame-average is unknown.
				children = append(children, hdrBox("clli", []byte{6, 64, 0, 0})...)
				count++
			}
			body = append(append([]byte{}, body[:skip]...), children...)
		}
		if b.kind != "mdcv" && b.kind != "clli" {
			result = append(result, hdrBox(b.kind, body)...)
		}
	}
	return result, count, nil
}

func hdrBox(kind string, body []byte) []byte {
	b := make([]byte, 8, len(body)+8)
	binary.BigEndian.PutUint32(b, uint32(len(body)+8))
	copy(b[4:], kind)
	return append(b, body...)
}
