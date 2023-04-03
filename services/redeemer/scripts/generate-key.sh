#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<-EOF
	usage: ${0##*/} <path-to-cbs> <count>

	Generate P256 elliptic curve private keys and commitments.

	"path-to-cbs" must be a path to a challenge-bypass-server, which
	is needed to generate the commitment.

	"count" must be a positive integer, the number of keys/commitments
	to generate.
	EOF
}

generate_pem() {
	local output=$1
	# Generate the private key.
	openssl ecparam -genkey \
		-name 'prime256v1' \
		-out "$output" \
		-noout
}

generate_commitment() {
	local key_file=$1
	local out_file=$2
	go run "$cbs_dir/crypto/generate_commitments_and_key.go" \
		-key "$key_file" \
		-out "$out_file" \
		> /dev/null
}

indent() {
	sed 's/^/    /g'
}

date_key() {
	local offset=$1
	date '+%Y-%m' --date="now + $offset month"
}

if [[ $# -ne 2 ]]; then
	usage >&2
	exit 1
fi

if [[ !( $2 =~ ^-?[0-9]+$ ) ]]; then
	echo "Invalid count: $2" >&2
	exit 1
fi

cbs_dir=$1
count=$2
output_dir=$(mktemp --directory -t cbs-keys-XXX)

for ((i=0; i<$count; i++)); do
	key_file="$output_dir/$i-key.pem"
	commitment_file="$output_dir/$i-commitment.json"

	generate_pem "$key_file"
	generate_commitment "$key_file" "$commitment_file"
done

for ((i=0; i<$count; i++)); do
	key_file="$output_dir/$i-key.pem"
	echo "$(date_key "$i"): |"
	cat "$key_file" | indent
	rm "$key_file"
done
echo

for ((i=0; i<$count; i++)); do
	commitment_file="$output_dir/$i-commitment.json"
	echo "$(date_key "$i"): |"
	cat "$commitment_file" | indent
	rm "$commitment_file"
	echo
done

rmdir "$output_dir"
