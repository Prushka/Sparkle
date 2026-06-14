'use client';

const GAME_HEIGHT = 178;
const COTTAGE_GAME_SURFACE_CLASS_NAME =
	'relative mx-auto w-full max-w-[90rem] overflow-hidden bg-[#312820] outline-none focus-visible:outline-none';

export function CottageGamePlaceholder() {
	return (
		<div
			aria-hidden="true"
			className={`${COTTAGE_GAME_SURFACE_CLASS_NAME} opacity-85 saturate-[0.92]`}
			style={{ height: GAME_HEIGHT }}
		>
			<div className="absolute inset-0 bg-[#312820]" />
			<div className="absolute inset-x-0 top-0 h-[37%] bg-[linear-gradient(180deg,#69725f_0%,#a28d68_100%)]" />
			<div className="absolute inset-x-0 bottom-0 h-[66%] bg-[linear-gradient(180deg,#bd8755_0%,#92603f_100%)]" />
			<div className="absolute inset-x-0 top-[34%] h-[6px] bg-[#785644]" />
			<div className="absolute inset-x-0 top-[45%] h-px bg-white/10" />
			<div className="absolute inset-x-0 top-[56%] h-px bg-black/10" />
			<div className="absolute inset-x-0 top-[68%] h-px bg-white/10" />
			<div className="absolute inset-x-0 top-[80%] h-px bg-black/10" />

			<div className="absolute left-[13%] top-[12%] h-[27%] w-[9.5%] bg-[#7b3942]">
				<div className="absolute left-[9%] top-[18%] h-[58%] w-[34%] bg-[#d7f1ff]" />
				<div className="absolute right-[9%] top-[18%] h-[58%] w-[34%] bg-[#d7f1ff]" />
				<div className="absolute left-[46%] top-[18%] h-[58%] w-[7%] bg-[#6f4050]" />
			</div>
			<div className="absolute right-[20%] top-[12%] h-[27%] w-[9.5%] bg-[#7b3942]">
				<div className="absolute left-[9%] top-[18%] h-[58%] w-[34%] bg-[#d7f1ff]" />
				<div className="absolute right-[9%] top-[18%] h-[58%] w-[34%] bg-[#d7f1ff]" />
				<div className="absolute left-[46%] top-[18%] h-[58%] w-[7%] bg-[#6f4050]" />
			</div>

			<div className="absolute left-[4%] top-[18%] h-[38%] w-[7%] rounded-sm bg-[#8e5940]">
				<div className="absolute left-[12%] top-[16%] h-[10%] w-[72%] bg-[#57372f]" />
				<div className="absolute left-[16%] top-[31%] h-[19%] w-[7%] bg-[#d7a84a]" />
				<div className="absolute left-[28%] top-[28%] h-[23%] w-[7%] bg-[#628bb0]" />
				<div className="absolute left-[40%] top-[32%] h-[18%] w-[7%] bg-[#6a9b68]" />
				<div className="absolute left-[52%] top-[29%] h-[21%] w-[7%] bg-[#bb777d]" />
				<div className="absolute left-[64%] top-[30%] h-[20%] w-[7%] bg-[#e0c383]" />
				<div className="absolute left-[12%] top-[57%] h-[10%] w-[72%] bg-[#57372f]" />
			</div>

			<div className="absolute left-[46%] top-[12%] h-[52%] w-[10.5%] rounded-md bg-[#8c6258]">
				<div className="absolute left-[17%] top-[23%] h-[48%] w-[66%] rounded bg-[#3e2a2a]" />
				<div className="absolute left-[42%] top-[42%] h-[28%] w-[18%] rounded-full bg-[#ffb347] shadow-[0_0_36px_rgba(255,177,71,0.58)]" />
				<div className="absolute left-[46%] top-[50%] h-[20%] w-[10%] rounded-full bg-[#ff724d]" />
			</div>

			<div className="absolute left-[13%] top-[60%] h-[25%] w-[13%] rounded-lg bg-[#9a586a]">
				<div className="absolute -top-[21%] left-[6%] h-[43%] w-[88%] rounded-md bg-[#b96c78]" />
				<div className="absolute bottom-[10%] left-[10%] h-[44%] w-[35%] rounded bg-[#c57982]" />
				<div className="absolute bottom-[10%] right-[10%] h-[44%] w-[35%] rounded bg-[#c57982]" />
			</div>

			<div className="absolute left-[35%] top-[58%] h-[32%] w-[10%] rounded-md bg-[#bf814f]">
				<div className="absolute left-[12%] top-[15%] h-[58%] w-[76%] rounded bg-[#d3945b]" />
				<div className="absolute -left-[30%] top-[28%] h-[44%] w-[27%] rounded bg-[#9f6b44]" />
				<div className="absolute -right-[30%] top-[28%] h-[44%] w-[27%] rounded bg-[#9f6b44]" />
				<div className="absolute left-[33%] top-[38%] h-[13%] w-[22%] bg-[#f7dfaf]" />
				<div className="absolute right-[19%] top-[45%] h-[11%] w-[18%] bg-[#f7dfaf]" />
			</div>

			<div className="absolute right-[8%] top-[54%] h-[34%] w-[13%] rounded-md bg-[#80583e]">
				<div className="absolute left-[8%] top-[10%] h-[75%] w-[84%] rounded bg-[#f1d6ad]" />
				<div className="absolute left-[10%] top-[18%] h-[24%] w-[35%] rounded bg-[#fff2d3]" />
				<div className="absolute right-[10%] top-[18%] h-[24%] w-[35%] rounded bg-[#fff2d3]" />
				<div className="absolute bottom-[12%] left-[8%] h-[38%] w-[84%] rounded bg-[#7295a5]" />
			</div>

			<div className="absolute right-[4%] top-[32%] h-[48%] w-[5%]">
				<div className="absolute bottom-0 left-[28%] h-[35%] w-[38%] rounded bg-[#9a6545]" />
				<div className="absolute left-[25%] top-[9%] h-[44%] w-[26%] rotate-[-18deg] rounded-full bg-[#486f4c]" />
				<div className="absolute right-[8%] top-[16%] h-[38%] w-[24%] rotate-[24deg] rounded-full bg-[#77a565]" />
				<div className="absolute left-[2%] top-[31%] h-[34%] w-[32%] rotate-[-35deg] rounded-full bg-[#486f4c]" />
			</div>

			<div className="absolute inset-0 bg-[radial-gradient(circle_at_51%_28%,rgba(255,188,91,0.28),transparent_22%),radial-gradient(circle_at_16%_62%,rgba(255,225,160,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_38%,rgba(30,20,18,0.22))] mix-blend-screen" />
			<div className="absolute inset-0 bg-black/10" />
		</div>
	);
}
