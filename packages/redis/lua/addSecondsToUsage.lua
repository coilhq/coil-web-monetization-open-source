-- NOTE: If you modify this file, be sure to test it with addSecondsToUsage.test.ts!

redis.replicate_commands()

-- $4.5 USD / month
local MAXIMUM_MONTHLY_LIMIT           = 1e9 * 4.5
local LOW_THROUGHPUT_MAX_AGG_INCREASE = 5e8
local BASE_THROUGHPUT                 = 100000
local LOW_THROUGHPUT                  = 186

-- Given that the user has spent `already_spent` nano-USD this month, compute the
-- amount of nano-USD spent if they stream for `spendSeconds` seconds.
--
-- The throughput isn't constant -- it starts out at `BASE_THROUGHPUT` until
-- they are near the monthly maximum, then it dials back to `LOW_THROUGHPUT`.

local function compute_limited_spend(args)
	local spent_amnt = args.spent_amnt -- nano-USD
	local limit_amnt = args.limit_amnt -- nano-USD
	local spend_secs = args.spend_secs -- seconds (duration)
	local throughput = args.throughput -- nano-USD/second

	if limit_amnt <= spent_amnt then
		-- Already over limit.
		return {
			spend_amnt     = 0,
			remaining_secs = spend_secs
		}
	end

	local want_to_spend_amnt = spend_secs * throughput
	local can_spend_amnt = limit_amnt - spent_amnt
	if want_to_spend_amnt <= can_spend_amnt then
		-- Well below limit.
		return {
			spend_amnt     = want_to_spend_amnt,
			remaining_secs = 0
		}
	end
	local spend_amnt = can_spend_amnt
	local remaining_amnt = want_to_spend_amnt - can_spend_amnt
	local remaining_secs = remaining_amnt / throughput
	return {
		spend_amnt     = spend_amnt,
		remaining_secs = remaining_secs
	}
end

-- This function returns an object with several fields. All but one of them
-- (`amount`) are included only for metrics/logging.
local function pay_seconds_to_nano_usd(spend_seconds, already_spent)
	local base = compute_limited_spend({
		spent_amnt = already_spent,
		limit_amnt = MAXIMUM_MONTHLY_LIMIT,
		spend_secs = spend_seconds,
		throughput = BASE_THROUGHPUT
	})
	local base_spend_amnt = base.spend_amnt
	local low_spend_seconds = base.remaining_secs
	local base_spend_seconds = spend_seconds - low_spend_seconds

	local total_amnt = 0
	local unspent_seconds = 0

	if low_spend_seconds == 0 then
		-- The whole payment could be made at the Base throughput.
		--return base_spend_amnt
		total_amnt = base_spend_amnt
	else
		-- Part or all of the payment needs to be made at the Low throughput.
		local low = compute_limited_spend({
			spent_amnt = already_spent + base_spend_amnt,
			limit_amnt = MAXIMUM_MONTHLY_LIMIT + LOW_THROUGHPUT_MAX_AGG_INCREASE,
			spend_secs = low_spend_seconds,
			throughput = LOW_THROUGHPUT
		})
		local low_spend_amnt = low.spend_amnt
		-- unspent_seconds is the leftover time that did not get converted into money.
		-- It is dropped -- the payment will pay as much as possible under the limit
		-- (potentially 0.00 USD).
		unspent_seconds = low.remaining_secs
		low_spend_seconds = low_spend_seconds - unspent_seconds
		total_amnt = base_spend_amnt + low_spend_amnt
	end

	return {
		amount          = total_amnt,
		base_seconds    = base_spend_seconds,
		low_seconds     = low_spend_seconds,
		unspent_seconds = unspent_seconds
	}
end

local function get_usage(usage_key)
	local bucket = redis.call('get', usage_key)
	if bucket then
		return cjson.decode(bucket)
	else
		return {
			last  = 0,
			left  = 0,
			total = 0,
			agg   = 0,
			in_flight = 0
		}
	end
end

local usage_key     = KEYS[1]              -- this is USAGE_KEY(userId)
local bucket        = get_usage(usage_key) -- { last, left, total, agg }
local spend_seconds = tonumber(ARGV[1])    -- seconds
local already_spent = bucket.agg           -- nano-USD

local result = pay_seconds_to_nano_usd(spend_seconds, already_spent)

if result.amount > 0 then
	bucket.agg = bucket.agg + result.amount
	redis.call("set", usage_key, cjson.encode(bucket))
end

return cjson.encode(result)
